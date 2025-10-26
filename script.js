// v13: 起動時の重複を必ず回避（list=random 優先）、LAST_KEYで直前を避ける

const output = document.getElementById('output');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const intervalSel = document.getElementById('intervalSel');
const genreSel = document.getElementById('genreSel');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');
const diagBtn = document.getElementById('diagBtn');
const logBtn = document.getElementById('logBtn');
const logPanel = document.getElementById('logPanel');
const logView = document.getElementById('log');
const banner = document.getElementById('banner');

const relatedStatus = document.getElementById('relatedStatus');
const relatedList = document.getElementById('relatedList');

let timer = null;
let pauseTimeout = null;
let current = null;
const historyBuf = [];
const categoryCache = {};

const SEEN_KEY_V13 = "siren_seen_titles_v13";
const SEEN_KEY_V11 = "siren_seen_titles_v11"; // 旧キーも参照
const LAST_KEY = "siren_last_title_v13";
const SEEN_LIMIT = 400;

let seenTitles = new Set(loadSeen());
let lastTitle = loadLast();

if (location.protocol === 'file:') banner.hidden = false;

function loadSeen(){
  try {
    const v13 = JSON.parse(localStorage.getItem(SEEN_KEY_V13) || "[]");
    const v11 = JSON.parse(localStorage.getItem(SEEN_KEY_V11) || "[]");
    return [...new Set([...(v13||[]), ...(v11||[])])];
  } catch { return []; }
}
function saveSeen(){
  try {
    const arr = Array.from(seenTitles).slice(-SEEN_LIMIT);
    localStorage.setItem(SEEN_KEY_V13, JSON.stringify(arr));
  } catch {}
}
function loadLast(){
  try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; }
}
function saveLast(t){
  try { localStorage.setItem(LAST_KEY, t || ""); } catch {}
}

function logLine(...args){
  const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log("[SirenTerminal]", s);
  logView.textContent += s + "\n";
}

function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function appendText(text){ output.textContent += text; output.scrollTop = output.scrollHeight; }

async function typeWriter(text, speed = 26) {
  return new Promise(resolve => {
    let i = 0;
    const step = () => {
      if (i < text.length) { output.textContent += text.charAt(i++); output.scrollTop = output.scrollHeight; setTimeout(step, speed); }
      else resolve();
    };
    step();
  });
}

function normalizeSummary(data) {
  const title = data.title || "（無題）";
  const blurb = data.description ? `──${data.description}` : (data.extract ? ("──" + data.extract.split("。")[0] + "。") : "──（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}

function bust(u){ const sep = u.includes('?') ? '&' : '?'; return `${u}${sep}t=${Date.now()}`; }

async function fetchJSON(url, options){
  const full = bust(url);
  logLine("GET", full);
  const res = await fetch(full, options || { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" });
  logLine("STATUS", res.status);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) throw new Error(`Non-JSON response (${ct}) for ${url}`);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  return await res.json();
}

// === 新：MediaWiki list=random を優先使用 ==========================
async function mwRandomTitles(n=20){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=" + n + "&origin=*");
  const arr = (data.query && data.query.random) ? data.query.random : [];
  return arr.map(x => x.title).filter(Boolean);
}

async function pickFreshRandomTitle(){
  // list=random で未表示かつ直前と違うものを選ぶ。最大3バッチ。
  for (let batch=0; batch<3; batch++){
    const titles = await mwRandomTitles(20);
    const cand = titles.find(t => t !== lastTitle && !seenTitles.has(t));
    if (cand) return cand;
  }
  // どうしても無理なら最後のバッチから lastTitle と違うもの
  const titles = await mwRandomTitles(20);
  const cand2 = titles.find(t => t !== lastTitle) || titles[0];
  return cand2;
}

async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return normalizeSummary(data);
}

async function fetchRandomSummaryPreferMW(){
  const t = await pickFreshRandomTitle();
  return await fetchSummaryByTitle(t);
}

// 旧 REST random はフォールバック用途に残す
async function fetchRandomSummaryREST(){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/random/summary");
  return normalizeSummary(data);
}
// ================================================================

async function restRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title));
  return (data.pages || []).map(p => normalizeSummary(p));
}

async function searchRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent('morelike:"' + title + '"') + "&srlimit=5&srnamespace=0&origin=*");
  const hits = (data.query && data.query.search) ? data.query.search : [];
  const titles = hits.map(h => h.title).filter(Boolean);
  const pages = [];
  for (const t of titles) {
    try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); pages.push(normalizeSummary(d)); }
    catch(e) { logLine("summary fail", t, e.message); }
  }
  return pages;
}

async function parseLinksRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=parse&format=json&page=" + encodeURIComponent(title) + "&prop=links&origin=*");
  const links = (data.parse && data.parse.links) ? data.parse.links : [];
  const titles = links.filter(l => l.ns === 0 && l['*']).slice(0, 10).map(l => l['*']);
  const pages = [];
  for (const t of titles) {
    try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); pages.push(normalizeSummary(d)); }
    catch(e) { logLine("summary fail", t, e.message); }
  }
  return pages;
}

async function opensearchRelated(title){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=5&namespace=0&origin=*");
  const titles = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  const pages = [];
  for (const t of titles) {
    try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); pages.push(normalizeSummary(d)); }
    catch(e) { logLine("summary fail", t, e.message); }
  }
  return pages;
}

async function categoryNeighbors(title){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles=" + encodeURIComponent(title) + "&origin=*");
  const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
  const cats = pages.length ? (pages[0].categories || []) : [];
  if (!cats.length) return [];
  const cat = cats[0].title;
  const data2 = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent(cat) + "&cmtype=page&cmnamespace=0&cmlimit=10&origin=*");
  const members = (data2.query && data2.query.categorymembers) ? data2.query.categorymembers : [];
  const titles = members.map(m => m.title).filter(Boolean);
  const out = [];
  for (const t of titles) {
    try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); out.push(normalizeSummary(d)); }
    catch(e) { logLine("summary fail", t, e.message); }
  }
  return out;
}

async function fetchRelatedRobust(title) {
  try { const r = await restRelated(title); if (r && r.length) { logLine("related: via REST"); return r; } }
  catch(e) { logLine("REST related failed:", e.message); }
  try { const s = await searchRelated(title); if (s && s.length) { logLine("related: via morelike search"); return s; } }
  catch(e) { logLine("Search related failed:", e.message); }
  try { const p = await parseLinksRelated(title); if (p && p.length) { logLine("related: via parse-links"); return p; } }
  catch(e) { logLine("Parse-links related failed:", e.message); }
  try { const o = await opensearchRelated(title); if (o && o.length) { logLine("related: via opensearch"); return o; } }
  catch(e) { logLine("Opensearch failed:", e.message); }
  try { const c = await categoryNeighbors(title); logLine("related: via category neighbors", c.length); return c; }
  catch(e) { logLine("Category neighbors failed:", e.message); return []; }
}

const GENRE_TO_CATEGORIES = {
  "哲学": ["哲学"],
  "科学": ["科学"],
  "数学": ["数学"],
  "技術": ["技術"],
  "芸術": ["芸術"],
  "言語学": ["言語学"],
  "心理学": ["心理学"],
  "歴史": ["歴史"],
  "文学": ["文学"]
};

async function getCategoryMembersForGenre(genre) {
  if (categoryCache[genre]?.length) return categoryCache[genre];
  const cats = GENRE_TO_CATEGORIES[genre] || [];
  let titles = [];
  for (const cat of cats) {
    const data = await fetchJSON(`https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=page&cmnamespace=0&cmlimit=500&origin=*`);
    const arr = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
    titles.push(...arr.map(it => it.title).filter(Boolean));
  }
  titles = Array.from(new Set(titles));
  categoryCache[genre] = titles;
  return titles;
}

function pickRandom(list){ return list[Math.floor(Math.random() * list.length)]; }

async function fetchFromGenreDedup(genre) {
  const list = await getCategoryMembersForGenre(genre);
  if (!list.length) throw new Error("カテゴリに項目が見つかりません: " + genre);
  const MAX_TRY = 12;
  for (let i = 0; i < MAX_TRY; i++){
    const t = pickRandom(list);
    if (seenTitles.has(t) || t === lastTitle) continue;
    const s = await fetchSummaryByTitle(t);
    if (!seenTitles.has(s.title) && s.title !== lastTitle) return s;
  }
  const t = pickRandom(list);
  return await fetchSummaryByTitle(t);
}

async function showOne(useMWPrefer=true) {
  try {
    const genre = genreSel.value;
    current = (genre === "all")
      ? (useMWPrefer ? await fetchRandomSummaryPreferMW() : await fetchRandomSummaryREST())
      : await fetchFromGenreDedup(genre);
    historyBuf.push(current);
    seenTitles.add(current.title);
    saveSeen();
    lastTitle = current.title;
    saveLast(lastTitle);
    if (historyBuf.length > 50) { historyBuf.shift(); }
    output.textContent = "";
    await typeWriter(`今日の概念：${current.title}\n\n`);
    await typeWriter(`${current.blurb}`);
    // 関連クリア
    relatedList.innerHTML = "";
    relatedStatus.textContent = "";
  } catch (err) {
    logLine("showOne error:", err.message);
    const fallback = historyBuf.length ? historyBuf[Math.floor(Math.random() * historyBuf.length)] : null;
    output.textContent = "";
    await typeWriter("（オンライン取得に失敗しました。履歴から再提示します）\n\n");
    if (fallback) {
      current = fallback;
      await typeWriter(`今日の概念：${current.title}\n\n`);
      await typeWriter(`${current.blurb}`);
    } else {
      await typeWriter("履歴がありません。オンラインに接続して再試行してください。");
    }
  }
}

detailBtn.addEventListener('click', () => {
  if (!current) return;
  appendText(`\n\n[詳細]\n${current.detail}\n\n[出典] ${current.url}`);
});

function pauseAutoResume(){
  if (timer) { clearInterval(timer); timer = null; }
  if (pauseTimeout) { clearTimeout(pauseTimeout); }
  pauseTimeout = setTimeout(() => { setupIntervalFromSelect(); }, 20000);
}

relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  pauseAutoResume();
  relatedStatus.textContent = "読み込み中…";
  relatedList.innerHTML = "";
  try {
    const rel = await fetchRelatedRobust(current.title);
    if (!rel.length) { relatedStatus.textContent = "（見つかりませんでした）"; return; }
    relatedStatus.textContent = `（${rel.length}件）`;
    rel.slice(0, 7).forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>`;
      relatedList.appendChild(li);
    });
  } catch (e) {
    relatedStatus.textContent = "（取得に失敗しました）";
    logLine("related final error:", e.message);
  }
});

openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
  else alert("まだ開ける項目がありません。もう一度お試しください。");
});

nextBtn.addEventListener('click', () => { if (timer) { clearInterval(timer); timer = null; } showOne(true).then(setupIntervalFromSelect); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });

genreSel.addEventListener('change', () => { if (timer) { clearInterval(timer); timer = null; } showOne(true).then(setupIntervalFromSelect); });

diagBtn.addEventListener('click', () => {
  const lines = [
    "[診断]",
    "オンライン: " + (navigator.onLine ? "Yes" : "No"),
    "タイトル: " + (current?.title || "（なし）"),
    "URL: " + (current?.url || "（なし）"),
    "既出タイトル数: " + seenTitles.size,
    "直前タイトル: " + (lastTitle || "（なし）")
  ];
  appendText("\n\n" + lines.join("\n"));
});
logBtn.addEventListener('click', () => { logPanel.open = !logPanel.open; });

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'o') { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); }
  if (e.key.toLowerCase() === 'n') { if (timer) { clearInterval(timer); timer = null; } showOne(true).then(setupIntervalFromSelect); }
});

function setupIntervalFromSelect() {
  if (timer) { clearInterval(timer); timer = null; }
  const val = parseInt(intervalSel.value, 10);
  if (val > 0) timer = setInterval(() => showOne(true), val);
}

// === 初回起動：必ず list=random で直前回避 ==================
showOne(true).then(setupIntervalFromSelect);
// ===========================================================

// PWA: SW登録 & 更新（localhost/HTTPSのみ）
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
} else {
  console.warn("Service Workerは https:// または http://localhost でのみ有効です。");
}
