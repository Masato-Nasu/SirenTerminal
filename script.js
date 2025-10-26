// v16: 二重バリア（直近200禁止 + 永続5000件）と厳格モード、メモリリセットボタン

const output = document.getElementById('output');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const intervalSel = document.getElementById('intervalSel');
const genreSel = document.getElementById('genreSel');
const raritySel = document.getElementById('raritySel');
const strictChk = document.getElementById('strictChk');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');
const resetBtn = document.getElementById('resetBtn');
const diagBtn = document.getElementById('diagBtn');
const logBtn = document.getElementById('logBtn');
const logPanel = document.getElementById('logPanel');
const logView = document.getElementById('log');
const banner = document.getElementById('banner');
const relatedStatus = document.getElementById('relatedStatus');
const relatedList = document.getElementById('relatedList');

let timer = null, pauseTimeout = null, showOneBusy = false;
let current = null;
const historyBuf = [];
const categoryCache = {};

// 永続メモリ（最大5000件、timestampは保持しない＝存在のみ）
const SEEN_KEY = "siren_seen_titles_v16_set";
const LAST_KEY = "siren_last_title_v16";
const SEEN_LIMIT = 5000;
// セッション内LRU（直近200件を絶対禁止）
const SESSION_LIMIT = 200;
let inSession = [];

let seenSet = new Set(loadSeenSet());
let lastTitle = loadLast();

if (location.protocol === 'file:') banner.hidden = false;

function loadSeenSet(){ try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; } }
function saveSeenSet(){
  try {
    if (seenSet.size > SEEN_LIMIT){
      // 最近のhistoryBufから優先保持しつつ、古いものを削減
      const keepRecent = new Set(historyBuf.map(h => h.title));
      const rest = Array.from(seenSet).filter(t => !keepRecent.has(t));
      const trimmed = Array.from(keepRecent).concat(rest).slice(0, SEEN_LIMIT);
      seenSet = new Set(trimmed);
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seenSet)));
  } catch {}
}
function loadLast(){ try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; } }
function saveLast(t){ try { localStorage.setItem(LAST_KEY, t || ""); } catch {} }

function logLine(...args){ const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '); console.log("[SirenTerminal]", s); logView.textContent += s + "\n"; }
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function appendText(text){ output.textContent += text; output.scrollTop = output.scrollHeight; }
async function typeWriter(text, speed = 26){ return new Promise(resolve => { let i=0; const step=()=>{ if(i<text.length){ output.textContent+=text.charAt(i++); output.scrollTop=output.scrollHeight; setTimeout(step, speed);} else resolve();}; step();}); }

function normalizeSummary(data){
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

// 低PV優先
function yyyymmdd(date){ const y=date.getUTCFullYear(); const m=String(date.getUTCMonth()+1).padStart(2,'0'); const d=String(date.getUTCDate()).padStart(2,'0'); return `${y}${m}${d}`; }
function pageviewURL(title, start, end){ return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia/all-access/user/${encodeURIComponent(title)}/daily/${start}/${end}`; }
async function avgPageviews30(title){
  const end = new Date(); end.setUTCDate(end.getUTCDate()-1);
  const start = new Date(); start.setUTCDate(start.getUTCDate()-31);
  const url = pageviewURL(title, yyyymmdd(start), yyyymmdd(end));
  const data = await fetchJSON(url);
  const items = (data.items||[]);
  const avg = items.length ? Math.round(items.reduce((a,b)=>a+(b.views||0),0)/items.length) : 0;
  logLine("PV", title, "avg30", avg);
  return avg;
}
async function mwRandomTitles(n=50){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=" + n + "&origin=*");
  const arr = (data.query && data.query.random) ? data.query.random : [];
  return arr.map(x => x.title).filter(Boolean);
}
function rarityThreshold(){
  switch (raritySel.value){
    case 'ultra': return 10;
    case 'rare':  return 50;
    default:      return 500;
  }
}
function violatesBarriers(title){
  if (strictChk.checked){
    if (title === lastTitle) return true;
    if (inSession.includes(title)) return true;
    if (seenSet.has(title)) return true;
  } else {
    if (title === lastTitle) return true;
    if (inSession.slice(-50).includes(title)) return true;
  }
  return false;
}
function touchSession(title){
  inSession.push(title);
  if (inSession.length > SESSION_LIMIT) inSession = inSession.slice(-SESSION_LIMIT);
}

async function pickCandidateAll(rarityOnly=false){
  const target = rarityThreshold();
  let best = null, bestPV = Number.MAX_SAFE_INTEGER;
  for (let batch=0; batch<4; batch++){
    const titles = await mwRandomTitles(50); // 200候補まで探索
    for (const cand of titles){
      if (violatesBarriers(cand)) continue;
      const pv = await avgPageviews30(cand);
      if (!rarityOnly){
        if (pv <= target) return {title:cand, pv};
      }else{
        if (pv <= target/2) return {title:cand, pv}; // さらに尖らせる
      }
      if (pv < bestPV){ bestPV = pv; best = {title:cand, pv}; }
    }
  }
  return best; // 妥協：最小PVの候補
}

async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  const s = normalizeSummary(data);
  return s;
}

async function pickAndSummarize(){
  // まず通常閾値で探す → ダメなら rarityOnly=true → それでもダメなら妥協
  let cand = await pickCandidateAll(false);
  if (!cand) cand = await pickCandidateAll(true);
  if (!cand) throw new Error("候補を見つけられませんでした（厳格すぎる可能性）");
  const s = await fetchSummaryByTitle(cand.title);
  // 正規化後のタイトルでもバリアを再確認
  if (violatesBarriers(s.title)){
    logLine("normalized title violated barriers, retrying:", s.title);
    // 再帰的にもう一度（最大3回）
    for (let i=0;i<3;i++){
      const again = await pickCandidateAll(true);
      if (!again) break;
      const ss = await fetchSummaryByTitle(again.title);
      if (!violatesBarriers(ss.title)) return ss;
    }
  }
  return s;
}

// 関連（v15相当）
async function restRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title));
  return (data.pages || []).map(p => normalizeSummary(p));
}
async function searchRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent('morelike:"' + title + '"') + "&srlimit=5&srnamespace=0&origin=*");
  const hits = (data.query && data.query.search) ? data.query.search : [];
  const titles = hits.map(h => h.title).filter(Boolean);
  const pages = [];
  for (const t of titles) { try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); pages.push(normalizeSummary(d)); } catch(e) { logLine("summary fail", t, e.message); } }
  return pages;
}
async function parseLinksRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=parse&format=json&page=" + encodeURIComponent(title) + "&prop=links&origin=*");
  const links = (data.parse && data.parse.links) ? data.parse.links : [];
  const titles = links.filter(l => l.ns === 0 && l['*']).slice(0, 10).map(l => l['*']);
  const pages = [];
  for (const t of titles) { try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); pages.push(normalizeSummary(d)); } catch(e) { logLine("summary fail", t, e.message); } }
  return pages;
}
async function opensearchRelated(title){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=5&namespace=0&origin=*");
  const titles = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  const pages = [];
  for (const t of titles) { try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); pages.push(normalizeSummary(d)); } catch(e) { logLine("summary fail", t, e.message); } }
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
  for (const t of titles) { try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t)); out.push(normalizeSummary(d)); } catch(e) { logLine("summary fail", t, e.message); } }
  return out;
}
async function fetchRelatedRobust(title) {
  try { const r = await restRelated(title); if (r && r.length) { logLine("related: via REST"); return r; } } catch(e) { logLine("REST related failed:", e.message); }
  try { const s = await searchRelated(title); if (s && s.length) { logLine("related: via morelike search"); return s; } } catch(e) { logLine("Search related failed:", e.message); }
  try { const p = await parseLinksRelated(title); if (p && p.length) { logLine("related: via parse-links"); return p; } } catch(e) { logLine("Parse-links related failed:", e.message); }
  try { const o = await opensearchRelated(title); if (o && o.length) { logLine("related: via opensearch"); return o; } } catch(e) { logLine("Opensearch failed:", e.message); }
  try { const c = await categoryNeighbors(title); logLine("related: via category neighbors", c.length); return c; } catch(e) { logLine("Category neighbors failed:", e.message); return []; }
}

// 表示
async function showOne(){
  if (showOneBusy){ logLine("skip showOne: busy"); return; }
  showOneBusy = true;
  try{
    const genre = genreSel.value;
    const s = await pickAndSummarize();
    current = s;
    historyBuf.push(current);
    lastTitle = s.title; saveLast(lastTitle);
    seenSet.add(s.title); saveSeenSet();
    touchSession(s.title);
    if (historyBuf.length > 50) historyBuf.shift();
    output.textContent = "";
    await typeWriter(`今日の概念：${s.title}\n\n`);
    await typeWriter(`${s.blurb}`);
    relatedList.innerHTML = "";
    relatedStatus.textContent = "";
  } catch(e){
    logLine("showOne error:", e.message);
    output.textContent = "（候補が見つかりませんでした。厳格をOFFにして再試行してください）";
  } finally {
    showOneBusy = false;
  }
}

detailBtn.addEventListener('click', () => { if (!current) return; appendText(`\n\n[詳細]\n${current.detail}\n\n[出典] ${current.url}`); });
function pauseAutoResume(){ if (timer){ clearInterval(timer); timer=null; } if (pauseTimeout){ clearTimeout(pauseTimeout); } pauseTimeout=setTimeout(()=>{ setupIntervalFromSelect(); }, 20000); }
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  pauseAutoResume();
  relatedStatus.textContent = "読み込み中…"; relatedList.innerHTML = "";
  try {
    const rel = await fetchRelatedRobust(current.title);
    if (!rel.length){ relatedStatus.textContent = "（見つかりませんでした）"; return; }
    relatedStatus.textContent = `（${rel.length}件）`;
    rel.slice(0,7).forEach((p,i)=>{
      const li=document.createElement('li');
      li.innerHTML = `[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>`;
      relatedList.appendChild(li);
    });
  } catch(e){ relatedStatus.textContent="（取得に失敗しました）"; logLine("related error", e.message); }
});
openBtn.addEventListener('click', () => { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); });
nextBtn.addEventListener('click', () => { if (timer){ clearInterval(timer); timer=null; } showOne().then(setupIntervalFromSelect); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });
resetBtn.addEventListener('click', () => {
  localStorage.removeItem(SEEN_KEY);
  localStorage.removeItem(LAST_KEY);
  inSession = [];
  seenSet = new Set();
  lastTitle = "";
  appendText("\n\n[リセット] 既出と直前情報をクリアしました。");
});
genreSel.addEventListener('change', () => { if (timer){ clearInterval(timer); timer=null; } showOne().then(setupIntervalFromSelect); });
raritySel.addEventListener('change', () => { if (timer){ clearInterval(timer); timer=null; } showOne().then(setupIntervalFromSelect); });
diagBtn.addEventListener('click', () => {
  const lines = [
    "[診断]",
    "オンライン: " + (navigator.onLine ? "Yes" : "No"),
    "タイトル: " + (current?.title || "（なし）"),
    "URL: " + (current?.url || "（なし）"),
    "既出（保存）件数: " + seenSet.size,
    "直近（セッション）件数: " + inSession.length,
    "直前タイトル: " + (lastTitle || "（なし）"),
    "レア度: " + raritySel.value,
    "厳格モード: " + (strictChk.checked ? "ON" : "OFF")
  ];
  appendText("\n\n" + lines.join("\n"));
});
logBtn.addEventListener('click', () => { logPanel.open = !logPanel.open; });
window.addEventListener('keydown', (e) => { if (e.key.toLowerCase()==='o'){ const url=current?.url||(current?.title? "https://ja.wikipedia.org/wiki/"+encodeURIComponent(current.title):null); if(url) window.open(url,'_blank','noopener'); } if (e.key.toLowerCase()==='n'){ if (timer){ clearInterval(timer); timer=null; } showOne().then(setupIntervalFromSelect); } });
function setupIntervalFromSelect(){ if (timer){ clearInterval(timer); timer=null; } const val=parseInt(intervalSel.value,10); if (val>0) timer=setInterval(showOne, val); }
// 初期表示
showOne().then(setupIntervalFromSelect);
// SW
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
} else { console.warn("Service Workerは https:// または http://localhost でのみ有効です。"); }
