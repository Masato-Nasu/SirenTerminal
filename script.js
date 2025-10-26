// v18.1: ジャンル復活・関連欄あり・非辞書順巡回・ログUIなし
const output = document.getElementById('output');
const genreSel = document.getElementById('genreSel');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');
const relatedStatus = document.getElementById('relatedStatus');
const relatedList = document.getElementById('relatedList');

let current = null;
let inSession = [];
const SESSION_LIMIT = 500;
const SEEN_LIMIT = 10000;
const SEEN_KEY = "siren_seen_titles_v18_1_set";
const LAST_KEY = "siren_last_title_v18_1";
const CURSOR_KEY_ALL = "siren_cursor_allpages_v18_1";
const CURSOR_KEY_CAT_PREFIX = "siren_cursor_cat_v18_1_";

// 起動ごとに異なるseed
let seed = null;
(async () => {
  const nowMS = Date.now().toString();
  const ua = navigator.userAgent || "";
  const rnd = crypto.getRandomValues(new Uint32Array(2)).join("-");
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(nowMS + "|" + ua + "|" + rnd));
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
async function fetchJSON(url){
  const res = await fetch(bust(url), { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const ct = res.headers.get('content-type')||'';
  if (!ct.includes('application/json')) throw new Error("Non-JSON");
  return await res.json();
}
function normalizeSummary(data){
  const title = data.title || "（無題）";
  const blurb = data.description ? `──${data.description}` : (data.extract ? ("──" + data.extract.split("。")[0] + "。") : "──（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}

// 非辞書順並べ替え（線形合同的変換）
function permuteIndices(n, base){
  const mult = 1664525;
  const out = new Array(n);
  for (let i=0;i<n;i++){ out[i] = (i*mult + base) % n; }
  return out;
}
function seedBase(extra=0){
  const s = seed ? Number((seed + BigInt(extra)) % 2147483647n) : Math.floor(Math.random()*2147483647);
  return (s <= 0) ? 1 : s;
}
function getCursorKeyForGenre(genre){
  return genre === "all" ? CURSOR_KEY_ALL : (CURSOR_KEY_CAT_PREFIX + genre);
}
function loadCursor(genre){ try { return localStorage.getItem(getCursorKeyForGenre(genre)) || ""; } catch { return ""; } }
function saveCursor(genre, cont){ try { localStorage.setItem(getCursorKeyForGenre(genre), cont || ""); } catch {} }

async function nextFromAllpages(){
  let cont = loadCursor("all");
  for (let page=0; page<20; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=allpages&apnamespace=0&aplimit=100&origin=*" + (cont ? "&apcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const pages = (data.query && data.query.allpages) ? data.query.allpages : [];
    const order = permuteIndices(pages.length, seedBase());
    for (const idx of order){
      const title = pages[idx].title;
      if (title === lastTitle) continue;
      if (inSession.includes(title)) continue;
      if (seenSet.has(title)) continue;
      saveCursor("all", (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "";
    saveCursor("all", cont);
    if (!cont){ saveCursor("all",""); inSession = []; }
  }
  return null;
}

async function nextFromCategory(genre){
  let cont = loadCursor(genre);
  for (let page=0; page<20; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:" + genre) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
    const order = permuteIndices(members.length, seedBase(genre.codePointAt(0)||0));
    for (const idx of order){
      const title = members[idx].title;
      if (title === lastTitle) continue;
      if (inSession.includes(title)) continue;
      if (seenSet.has(title)) continue;
      saveCursor(genre, (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
    saveCursor(genre, cont);
    if (!cont){ saveCursor(genre,""); inSession = []; }
  }
  return null;
}

async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return normalizeSummary(data);
}

async function pickNext(){
  const g = genreSel.value;
  if (g === "all"){
    // カテゴリ横断で色が偏らないよう、カテゴリを一巡
    const GENRES = ["哲学","科学","数学","技術","芸術","言語学","心理学","歴史","文学"];
    for (let i=0;i<GENRES.length;i++){
      const t = await nextFromCategory(GENRES[(i + seedBase()) % GENRES.length]);
      if (t) return await fetchSummaryByTitle(t);
    }
    // カテゴリで見つからなければ全ページへ
    const t2 = await nextFromAllpages();
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  } else {
    const t = await nextFromCategory(g);
    if (t) return await fetchSummaryByTitle(t);
    // そのカテゴリが尽きたら一旦allpagesへフォールバック
    const t2 = await nextFromAllpages();
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  }
}

function renderMain(s){
  output.textContent = `今日の概念：${s.title}\n\n${s.blurb}`;
  relatedList.innerHTML = "";
  relatedStatus.textContent = "";
}

async function showOne(){
  const s = await pickNext();
  if (!s){
    output.textContent = "（候補が見つかりません。ジャンルを変えるか時間をおいて再試行してください）";
    return;
  }
  current = s;
  lastTitle = s.title; saveLast(lastTitle);
  seenSet.add(s.title); saveSeen();
  inSession.push(s.title); if (inSession.length > SESSION_LIMIT) inSession = inSession.slice(-SESSION_LIMIT);
  renderMain(s);
}

detailBtn.addEventListener('click', () => {
  if (!current) return;
  output.textContent += `\n\n[詳細]\n${current.detail}\n\n[出典] ${current.url}`;
});
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  relatedStatus.textContent = "読み込み中…"; relatedList.innerHTML = "";
  try {
    const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title));
    const rel = (data.pages || []).map(p => normalizeSummary(p));
    if (!rel.length){ relatedStatus.textContent = "（見つかりませんでした）"; return; }
    relatedStatus.textContent = `（${rel.length}件）`;
    rel.slice(0,7).forEach((p,i)=>{
      const li = document.createElement('li');
      li.innerHTML = `[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${p.title}</a>`;
      relatedList.appendChild(li);
    });
  } catch(e){
    relatedStatus.textContent = "（取得に失敗しました）";
  }
});
openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});
nextBtn.addEventListener('click', () => { showOne(); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });

// 起動1.2秒後に最初の概念
setTimeout(()=>{ showOne(); }, 1200);

// PWA登録（静音）
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
}
