// v19: 展示モード（非辞書順シーケンス／ランダムAPI不使用／ログなし）
const output = document.getElementById('output');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');

let current = null;
let inSession = [];
const SESSION_LIMIT = 500;
const SEEN_LIMIT = 10000;
const SEEN_KEY = "siren_seen_titles_v19_set";
const LAST_KEY = "siren_last_title_v19";
const CURSOR_KEY_ALL = "siren_cursor_allpages_v19";
const CURSOR_KEY_CAT_PREFIX = "siren_cursor_cat_v19_";

// シード（毎起動で変わる）
let seed = null;
(async () => {
  const nowDay = new Date().toISOString().slice(0,10); // YYYY-MM-DD
  const ua = navigator.userAgent || "";
  const rnd = crypto.getRandomValues(new Uint32Array(2)).join("-");
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(nowDay + "|" + ua + "|" + rnd));
  const view = new DataView(buf);
  seed = BigInt(view.getUint32(0)) << 32n ^ BigInt(view.getUint32(4));
})();

function loadSeen(){ try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; } }
function saveSeen(){
  try {
    if (seenSet.size > SEEN_LIMIT){
      const keep = Array.from(seenSet).slice(-SEEN_LIMIT);
      seenSet = new Set(keep);
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seenSet)));
  } catch {}
}
function loadLast(){ try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; } }
function saveLast(t){ try { localStorage.setItem(LAST_KEY, t || ""); } catch {} }

let seenSet = new Set(loadSeen());
let lastTitle = loadLast();

function bust(u){ const sep = u.includes('?') ? '&' : '?'; return `${u}${sep}t=${Date.now()}`; }
async function fetchJSON(url){ const res = await fetch(bust(url), { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" }); if (!res.ok) throw new Error("HTTP " + res.status); const ct = res.headers.get('content-type')||''; if (!ct.includes('application/json')) throw new Error("Non-JSON"); return await res.json(); }

function normalizeSummary(data){
  const title = data.title || "（無題）";
  const blurb = data.description ? `──${data.description}` : (data.extract ? ("──" + data.extract.split("。")[0] + "。") : "──（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}

// 擬似乱数化：hash文字列→uint32
async function h32(str){
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  const v = new DataView(buf);
  return v.getUint32(0); // 先頭だけ使う
}
function permuteIndices(n, base){
  // 線形合同法で単純に巡回: i -> (i*mult + base) mod n, multは奇数
  const mult = 1664525; // 代表的な奇数乗数
  const out = new Array(n);
  for (let i=0;i<n;i++){ out[i] = (i*mult + base) % n; }
  return out;
}

function getCursorKeyForGenre(genre){
  return genre === "all" ? CURSOR_KEY_ALL : (CURSOR_KEY_CAT_PREFIX + genre);
}
function loadCursor(genre){ try { return localStorage.getItem(getCursorKeyForGenre(genre)) || ""; } catch { return ""; } }
function saveCursor(genre, cont){ try { localStorage.setItem(getCursorKeyForGenre(genre), cont || ""); } catch {} }

async function nextFromAllpages(){
  let cont = loadCursor("all");
  // 20ページ×100件=2000件ぶんを最大探索
  for (let page=0; page<20; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=allpages&apnamespace=0&aplimit=100&origin=*" + (cont ? "&apcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const pages = (data.query && data.query.allpages) ? data.query.allpages : [];
    // seedで並び替え（辞書順→擬似ランダムへ）
    const base = Number(seed ? (seed % 2147483647n) : BigInt(Math.floor(Math.random()*2147483647)));
    const order = permuteIndices(pages.length, base);
    for (const idx of order){
      const p = pages[idx];
      const title = p.title;
      if (title === lastTitle) continue;
      if (inSession.includes(title)) continue;
      if (seenSet.has(title)) continue;
      saveCursor("all", (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "";
    saveCursor("all", cont);
    if (!cont) { // 末尾→先頭へ
      saveCursor("all", "");
      inSession = [];
    }
  }
  return null;
}

const GENRES = ["哲学","科学","数学","技術","芸術","言語学","心理学","歴史","文学"];
function genreRoundRobin(page){
  // 哲学→科学→…を混ぜる。page値でオフセット。
  return GENRES[(page % GENRES.length)];
}
async function nextFromCategoryMix(){
  // 8カテゴリを1件ずつ混ぜながら進める。各カテゴリのcmcontinueは個別保存。
  for (let round=0; round<24; round++){ // 最大24カテゴリ分スキャン
    const g = genreRoundRobin(round);
    const key = getCursorKeyForGenre(g);
    let cont = loadCursor(g);
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:" + g) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
    // seedとカテゴリ名で並び替え
    const base = Number(seed ? (seed % 2147483647n) : BigInt(Math.floor(Math.random()*2147483647)));
    const order = permuteIndices(members.length, (base + (g.codePointAt(0)||0)) % 2147483647);
    for (const idx of order){
      const m = members[idx];
      const title = m.title;
      if (title === lastTitle) continue;
      if (inSession.includes(title)) continue;
      if (seenSet.has(title)) continue;
      saveCursor(g, (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
    saveCursor(g, cont);
    if (!cont){
      saveCursor(g, "");
      inSession = [];
    }
  }
  return null;
}

async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return normalizeSummary(data);
}

async function pickNext(){
  // カテゴリMIXで横広げ → ダメならallpagesにフォールバック
  const t1 = await nextFromCategoryMix();
  if (t1) return await fetchSummaryByTitle(t1);
  const t2 = await nextFromAllpages();
  if (t2) return await fetchSummaryByTitle(t2);
  return null;
}

function showText(title, blurb){
  output.textContent = `今日の概念：${title}\n\n${blurb}`;
}

async function showOne(){
  const s = await pickNext();
  if (!s){
    output.textContent = "（候補が見つかりません。時間をおいて再試行してください）";
    return;
  }
  current = s;
  lastTitle = s.title; saveLast(lastTitle);
  seenSet.add(s.title); saveSeen();
  inSession.push(s.title); if (inSession.length > SESSION_LIMIT) inSession = inSession.slice(-SESSION_LIMIT);
  showText(s.title, s.blurb);
}

detailBtn.addEventListener('click', () => { if (!current) return; output.textContent += `\n\n[詳細]\n${current.detail}\n\n[出典] ${current.url}`; });
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  try {
    const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title));
    const rel = (data.pages || []).map(p => normalizeSummary(p));
    if (!rel.length){ output.textContent += "\n\n[関連] なし"; return; }
    const lines = rel.slice(0,7).map((p,i)=>`[${i+1}] ${p.title} — ${p.url}`);
    output.textContent += "\n\n[関連]\n" + lines.join("\n");
  } catch(e){
    output.textContent += "\n\n[関連] 取得に失敗しました";
  }
});
openBtn.addEventListener('click', () => { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); });
nextBtn.addEventListener('click', () => { showOne(); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });

// 起動1.5秒後に最初の概念
setTimeout(()=>{ showOne(); }, 1500);

// PWA登録（静かに更新）
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
}
