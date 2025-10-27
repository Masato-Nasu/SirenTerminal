
// v21.2: genre-wide relevance filters + category mapping
const titleBox = document.getElementById('title');
const blurbBox = document.getElementById('blurb');
const genreSel = document.getElementById('genreSel');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const clearBtn = document.getElementById('clearBtn');
const maintext = document.getElementById('maintext');
const altview = document.getElementById('altview');

let current = null;
const SEEN_KEY = "siren_seen_titles_v21_2";
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));

// ---- helpers ----
function loadJSON(key, fallback){ try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function saveJSON(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function saveSeen(){
  if (seenSet.size > SEEN_LIMIT){
    const keep = Array.from(seenSet).slice(-Math.floor(SEEN_LIMIT*0.8));
    seenSet = new Set(keep);
  }
  saveJSON(SEEN_KEY, Array.from(seenSet));
}
function sessionSalt() {
  let s = sessionStorage.getItem('siren_launch_salt_v21_2');
  if (!s){
    s = String(crypto.getRandomValues(new Uint32Array(2))[0] ^ Date.now());
    sessionStorage.setItem('siren_launch_salt_v21_2', s);
  }
  return BigInt.asUintN(64, BigInt(parseInt(s,10) >>> 0));
}
async function timeSeed(){
  const nowSec = Math.floor(Date.now()/1000);
  const perf = (performance.now()*1000|0) & 0xffffffff;
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  const str = `${nowSec}|${perf}|${rnd[0]}|${rnd[1]}|${navigator.userAgent}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  const dv = new DataView(buf);
  const base = (BigInt(dv.getUint32(0))<<32n) | BigInt(dv.getUint32(4));
  return base ^ sessionSalt();
}
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return((t^t>>>14)>>>0)/4294967296; } }
function shuffleWithSeed(arr, seedBig){
  const seedLow = Number(seedBig & 0xffffffffn) || 1;
  const rand = mulberry32(seedLow);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
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
  const blurb = data.description ? `${data.description}` : (data.extract ? (data.extract.split("。")[0] + "。") : "（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url, description: (data.description||"") };
}
async function withBackoff(fn, tries=5){
  let lastErr;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch(e){ lastErr=e; await new Promise(r=>setTimeout(r, Math.min(1600, 200*Math.pow(2,i)))); }
  }
  throw lastErr;
}

// ---- genre mapping ----
const GENRE_MAP = {
  "all": [],
  "哲学": ["哲学"],
  "科学": ["自然科学","物理学","化学","生物学","天文学","地球科学","科学的方法","統計学"],
  "数学": ["数学"],
  "技術": ["工学","情報技術","電気工学","機械工学","材料工学","計算機科学","ソフトウェア工学"],
  "芸術": ["芸術","美術","音楽","音楽理論","デザイン"],
  "言語学": ["言語学"],
  "心理学": ["心理学","認知科学"],
  "歴史": ["歴史学","世界史","日本史"],
  "文学": ["文学","詩","物語論","文学理論"]
};

// Positive/Negative patterns by genre
const NEG_COMMON = /(企業|会社|市|町|村|鉄道|駅|空港|高校|大学|中学校|小学校|自治体|球団|クラブ|漫画|アニメ|映画|ドラマ|楽曲|アルバム|ゲーム|番組|作品|小説|キャラクター|政治家|俳優|女優|歌手|選手|監督)/;
const POS = {
  "科学": /(学|理論|定理|法則|効果|反応|方程式|現象|仮説|粒子|素粒子|銀河|惑星|恒星|元素|分子|化合物|酵素|細胞|進化|遺伝|電磁|量子|統計|確率|幾何|解析|熱力学|流体|計算|アルゴリズム|データ構造)/,
  "数学": /(数学|定理|補題|命題|証明|写像|群|環|体|加群|トポロジー|測度|微積分|幾何|確率|解析|代数|最適化|数論|組合せ)/,
  "哲学": /(哲学|形而上学|倫理学|認識論|美学|論理|パラドックス|思考実験|概念|命題|規範|価値)/,
  "技術": /(工学|技術|製造|制御|アルゴリズム|プロトコル|アーキテクチャ|通信|暗号|計算|機械|回路|半導体|材料|プログラミング)/,
  "言語学": /(言語学|文法|語彙|意味論|統語論|音韻|音声|形態論|語用論|言語獲得|言語変化)/,
  "心理学": /(心理学|認知|知覚|学習|記憶|注意|動機づけ|感情|発達|人格|臨床|行動|バイアス)/,
  "歴史": /(歴史|時代|王朝|帝国|戦争|条約|革命|制度|年表|史学|文明|文化|遺跡)/,
  "文学": /(文学|詩学|修辞|叙事|叙情|物語論|ジャンル|文芸|文学理論)/,
  "芸術": /(芸術|美術|造形|デザイン|建築|音楽理論|調性|和声|対位法|色彩|構図)/
};

function titlePassesGenre(genre, summary){
  if (genre === "all") return true;
  const d = (summary.description||"");
  // Some genres allow works (芸術/文学/歴史の一部) — loosen negative filter
  const allowWorks = (genre === "芸術" || genre === "文学");
  if (!allowWorks && NEG_COMMON.test(d)) return false;
  const pos = POS[genre];
  if (!pos) return true; // no positive pattern — be permissive
  return pos.test(d) || d === ""; // if description missing, allow
}

// ---- Wiki category helpers ----
async function fetchCategoryBatch(catTitle, cmcontinue=""){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle="
    + encodeURIComponent("Category:"+catTitle)
    + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*"
    + (cmcontinue ? "&cmcontinue="+encodeURIComponent(cmcontinue) : "");
  const data = await withBackoff(()=>fetchJSON(url));
  const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
  const cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
  return { titles: members.map(m=>m.title), cont };
}

async function getTitlesByGenre(genre, seed){
  const cats = GENRE_MAP[genre] || [genre];
  if (!cats.length) return [];
  let titles = [];
  for (const c of cats){
    let cont = ""; let collected = [];
    for (let i=0;i<2;i++){
      const r = await fetchCategoryBatch(c, cont);
      collected = collected.concat(r.titles);
      cont = r.cont;
      if (!cont) break;
    }
    titles = titles.concat(collected);
  }
  if (!titles.length) return [];
  titles = Array.from(new Set(titles));
  shuffleWithSeed(titles, seed);
  return titles;
}

async function getRandomTitles(limit=200){
  const data = await withBackoff(()=>fetchJSON(
    "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit="+limit+"&origin=*"
  ));
  const arr = (data.query && data.query.random) ? data.query.random : [];
  return arr.map(x => x.title);
}

async function fetchSummaryByTitle(title){
  try {
    const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title)));
    return normalizeSummary(d);
  } catch(e1){
    try{
      const d2 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=1&namespace=0&origin=*"));
      const t = Array.isArray(d2) && d2[1] && d2[1][0] ? d2[1][0] : title;
      const d3 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)));
      return normalizeSummary(d3);
    }catch(e2){
      return { title, blurb:"（概要取得に失敗）", detail:"（詳細取得に失敗）", url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(title), description: "" };
    }
  }
}

// ---- UI helpers ----
function showMain(){ maintext.hidden = false; altview.hidden = true; backBtn.hidden = true; }
function showAlt(html){ altview.innerHTML = html; maintext.hidden = true; altview.hidden = false; backBtn.hidden = false; }
function renderMain(s){ titleBox.textContent = `【 ${s.title} 】`; blurbBox.textContent = s.blurb; showMain(); }

// ---- Title Pool ----
let pool = [];
let fetching = false;

async function refillPool(minNeeded = 160){
  if (fetching) return;
  fetching = true;
  try{
    const g = (genreSel && genreSel.value) ? genreSel.value : "all";
    const seed = await timeSeed();

    let titles = [];
    if (g === "all" || !GENRE_MAP[g] || GENRE_MAP[g].length === 0){
      titles = await getRandomTitles(220);
    } else {
      titles = await getTitlesByGenre(g, seed);
    }

    titles = shuffleWithSeed(
      titles.filter(t => !seenSet.has(t)),
      seed ^ BigInt(pool.length)
    );

    const exist = new Set(pool);
    for (const t of titles){
      if (!exist.has(t)) pool.push(t);
      if (pool.length >= minNeeded) break;
    }
  } finally {
    fetching = false;
  }
}

async function pickNew(){
  if (pool.length < 12) await refillPool(200);
  let title = null;
  while (pool.length){
    const t = pool.shift();
    if (!seenSet.has(t)){ title = t; break; }
  }
  if (!title){
    await refillPool(220);
    if (!pool.length) return null;
    title = pool.shift();
  }
  let s = await fetchSummaryByTitle(title);

  // apply genre filter universally (except "all")
  const g = (genreSel && genreSel.value) ? genreSel.value : "all";
  if (g !== "all" && !titlePassesGenre(g, s)){
    for (let i=0;i<5;i++){
      if (!pool.length){ await refillPool(220); }
      const t2 = pool.shift();
      if (!t2) break;
      s = await fetchSummaryByTitle(t2);
      if (titlePassesGenre(g, s)) break;
    }
  }
  return s;
}

let busy = false;
async function showOne(){
  if (busy) return;
  busy = true;
  try{
    const s = await pickNew();
    if (!s){
      titleBox.textContent = "（候補が見つかりません）";
      blurbBox.textContent = "時間をおいて再試行してください。";
      showMain();
      return;
    }
    current = s;
    seenSet.add(s.title); saveSeen();
    renderMain(s);
  } catch(e){
    titleBox.textContent = "（取得エラー）";
    blurbBox.textContent = "通信が混み合っています。少し待ってNEXTをお試しください。";
    showMain();
  } finally {
    busy = false;
  }
}

// ---- events ----
if (detailBtn) detailBtn.addEventListener('click', () => {
  if (!current) return;
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});
if (relatedBtn) relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
  try {
    const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title)));
    const r = (d.pages || []).map(p => normalizeSummary(p));
    if (!r.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
    const items = r.slice(0,9).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("");
    showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
  } catch(e){
    showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
  }
});
if (openBtn) openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});
if (nextBtn) nextBtn.addEventListener('click', () => { showOne(); });
if (backBtn) backBtn.addEventListener('click', () => { showMain(); });
if (clearBtn) clearBtn.addEventListener('click', () => { if (!altview.hidden) showMain(); });

// 初期表示
(async () => {
  setTimeout(()=>{}, 0);
  await refillPool(200);
  showOne();
})();

// SW登録
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch(()=>{});
}

function escapeHtml(str){
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'};
  return String(str).replace(/[&<>"']/g, s => map[s]);
}