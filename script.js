// v10: 重複回避 & cacheBust。三段フォールバック関連、ログUI、正方形UIを維持。

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

let timer = null;
let current = null;
const historyBuf = [];
const seenTitles = new Set(); // 表示済みタイトル
const categoryCache = {};

if (location.protocol === 'file:') banner.hidden = false;

function logLine(...args){
  const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log("[SirenTerminal]", s);
  logView.textContent += s + "\n";
}

function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function appendText(text){ output.textContent += text; output.scrollTop = output.scrollHeight; }
function appendHTML(html){ output.insertAdjacentHTML('beforeend', html); output.scrollTop = output.scrollHeight; }

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

function bust(u){
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}t=${Date.now()}`;
}

async function fetchJSON(url, options){
  const full = bust(url);
  logLine("GET", full);
  const res = await fetch(full, options || { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" });
  logLine("STATUS", res.status);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
  const data = await res.json();
  return data;
}

async function fetchRandomSummaryOnce(){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/random/summary");
  return normalizeSummary(data);
}

// ランダム：重複回避リトライ（最大8回）
async function fetchRandomSummaryDedup(){
  const MAX_TRY = 8;
  for (let i = 0; i < MAX_TRY; i++){
    const s = await fetchRandomSummaryOnce();
    if (!seenTitles.has(s.title)) return s;
  }
  // どうしても避けられない場合は最後のものを返す
  return await fetchRandomSummaryOnce();
}

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
    try {
      const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t));
      pages.push(normalizeSummary(d));
    } catch(e) { logLine("summary fail", t, e.message); }
  }
  return pages;
}

async function parseLinksRelated(title) {
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=parse&format=json&page=" + encodeURIComponent(title) + "&prop=links&origin=*");
  const links = (data.parse && data.parse.links) ? data.parse.links : [];
  const titles = links.filter(l => l.ns === 0 && l['*']).slice(0, 10).map(l => l['*']);
  const pages = [];
  for (const t of titles) {
    try {
      const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t));
      pages.push(normalizeSummary(d));
    } catch(e) { logLine("summary fail", t, e.message); }
  }
  return pages;
}

async function fetchRelatedRobust(title) {
  try {
    const r = await restRelated(title);
    if (r && r.length) return r;
    logLine("REST related empty, trying search");
  } catch(e) {
    logLine("REST related failed:", e.message);
  }
  try {
    const s = await searchRelated(title);
    if (s && s.length) return s;
    logLine("Search related empty, trying parse-links");
  } catch(e) {
    logLine("Search related failed:", e.message);
  }
  try {
    const p = await parseLinksRelated(title);
    return p;
  } catch(e) {
    logLine("Parse-links related failed:", e.message);
    return [];
  }
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
    if (seenTitles.has(t)) continue;
    const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t));
    const s = normalizeSummary(data);
    if (!seenTitles.has(s.title)) return s;
  }
  // どうしても被るなら最後の一件を返す
  const t = pickRandom(list);
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t));
  return normalizeSummary(data);
}

async function showOne() {
  try {
    const genre = genreSel.value;
    current = (genre === "all") ? await fetchRandomSummaryDedup() : await fetchFromGenreDedup(genre);
    historyBuf.push(current);
    seenTitles.add(current.title);
    if (historyBuf.length > 50) { const removed = historyBuf.shift(); /* keep set; it's OK */ }
    output.textContent = "";
    await typeWriter(`今日の概念：${current.title}\n\n`);
    await typeWriter(`${current.blurb}`);
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

relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  appendText(`\n\n[関連項目] 読み込み中...`);
  try {
    const rel = await fetchRelatedRobust(current.title);
    output.textContent = output.textContent.replace(/\[関連項目\] 読み込み中\.\.\.$/, "[関連項目]");
    if (!rel.length) { appendText(`\n- （関連が見つかりませんでした）`); return; }
    let html = "";
    rel.slice(0, 7).forEach((p, i) => {
      const safeTitle = escapeHtml(p.title);
      html += `\n- [${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${safeTitle}</a>`;
    });
    appendHTML(html);
  } catch (e) {
    appendText(`\n- （関連取得に失敗しました）`);
    logLine("related final error:", e.message);
  }
});

openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
  else alert("まだ開ける項目がありません。もう一度お試しください。");
});

nextBtn.addEventListener('click', () => { if (timer) { clearInterval(timer); timer = null; } showOne().then(setupIntervalFromSelect); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });

genreSel.addEventListener('change', () => { 
  if (timer) { clearInterval(timer); timer = null; } 
  showOne().then(setupIntervalFromSelect); 
});

diagBtn.addEventListener('click', () => {
  const lines = [
    "[診断]",
    "オンライン: " + (navigator.onLine ? "Yes" : "No"),
    "タイトル: " + (current?.title || "（なし）"),
    "URL: " + (current?.url || "（なし）"),
    "履歴件数: " + historyBuf.length,
    "既出タイトル数: " + seenTitles.size
  ];
  appendText("\n\n" + lines.join("\n"));
});
logBtn.addEventListener('click', () => { logPanel.open = !logPanel.open; });

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'o') { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); }
  if (e.key.toLowerCase() === 'n') { if (timer) { clearInterval(timer); timer = null; } showOne().then(setupIntervalFromSelect); }
});

function setupIntervalFromSelect() {
  if (timer) { clearInterval(timer); timer = null; }
  const val = parseInt(intervalSel.value, 10);
  if (val > 0) timer = setInterval(showOne, val);
}

// 初期表示
showOne().then(setupIntervalFromSelect);

// PWA: SW登録 & 更新（localhost/HTTPSのみ）
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
} else {
  console.warn("Service Workerは https:// または http://localhost でのみ有効です。");
}
