// Siren Terminal – Wikipedia版（v4 修正）
// 注意: Service Worker と fetch の挙動のため、file:// ではなく http(s):// で開いてください。
// 例: ターミナルで `python3 -m http.server` 実行 → http://localhost:8000/ にアクセス。

const output = document.getElementById('output');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const intervalSel = document.getElementById('intervalSel');
const genreSel = document.getElementById('genreSel');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');

let timer = null;
let current = null;
const historyBuf = [];
const categoryCache = {};

function log(...args){ console.log("[SirenTerminal]", ...args); }

function typeWriter(text, speed = 26) {
  return new Promise(resolve => {
    let i = 0;
    const step = () => {
      if (i < text.length) { output.textContent += text.charAt(i++); setTimeout(step, speed); }
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

async function fetchRandomSummary() {
  const url = "https://ja.wikipedia.org/api/rest_v1/page/random/summary";
  log("fetch random:", url);
  const res = await fetch(url, { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error("Wikipedia fetch failed: " + res.status);
  const data = await res.json();
  return normalizeSummary(data);
}

async function fetchRelated(title) {
  const url = "https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title);
  log("fetch related:", url);
  const res = await fetch(url, { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error("Wikipedia related fetch failed: " + res.status);
  const data = await res.json();
  return (data.pages || []).map(p => normalizeSummary(p));
}

const GENRE_TO_CATEGORIES = {
  "哲学": ["哲学"],
  "科学": ["科学"],
  "数学": ["数学"],
  "技術": ["技術"],
  "芸術": ["芸術"],
  "言語学": ["言語学"],
  "心理学": ["心理学"],
  "歴史": ["歴史"]
};

async function getCategoryMembersForGenre(genre) {
  if (categoryCache[genre]?.length) return categoryCache[genre];
  const cats = GENRE_TO_CATEGORIES[genre] || [];
  let titles = [];
  for (const cat of cats) {
    // 記事 namespace (=0) に限定。origin=* で CORS 許可。
    const url = `https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=${encodeURIComponent('Category:' + cat)}&cmtype=page&cmnamespace=0&cmlimit=500&origin=*`;
    log("fetch category members:", url);
    const res = await fetch(url, { mode: "cors", cache: "no-store" });
    if (!res.ok) continue;
    const data = await res.json();
    const arr = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
    titles.push(...arr.map(it => it.title).filter(Boolean));
  }
  titles = Array.from(new Set(titles));
  categoryCache[genre] = titles;
  log("cached titles for genre", genre, titles.length);
  return titles;
}

async function fetchFromGenre(genre) {
  const list = await getCategoryMembersForGenre(genre);
  if (!list.length) throw new Error("カテゴリに項目が見つかりません: " + genre);
  const pick = list[Math.floor(Math.random() * list.length)];
  const url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(pick);
  log("fetch summary by title:", url);
  const res = await fetch(url, { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error("summary fetch failed: " + res.status);
  const data = await res.json();
  return normalizeSummary(data);
}

async function showOne() {
  try {
    const genre = genreSel.value;
    current = (genre === "all") ? await fetchRandomSummary() : await fetchFromGenre(genre);
    historyBuf.push(current);
    if (historyBuf.length > 50) historyBuf.shift();
    output.textContent = "";
    await typeWriter(`今日の概念：${current.title}\n\n`);
    await typeWriter(`${current.blurb}`);
  } catch (err) {
    log("showOne error:", err);
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
  output.textContent += `\n\n[詳細]\n${current.detail}\n\n[出典] ${current.url}`;
});

relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  output.textContent += `\n\n[関連項目] 読み込み中…`;
  try {
    const rel = await fetchRelated(current.title);
    if (!rel.length) { output.textContent += `\n- （関連なし）`; return; }
    output.textContent += "\n";
    // クリックで開けるように、番号付きにして案内
    rel.slice(0, 5).forEach((p, i) => {
      output.textContent += `- [${i+1}] ${p.title}  ${p.url}\n`;
    });
    output.textContent += `\n（リンクをクリックするとWikipediaが開きます）`;
  } catch (e) {
    output.textContent += `\n- （関連取得に失敗しました）`;
    log("related error:", e);
  }
});

openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) {
    window.open(url, '_blank', 'noopener');
  } else {
    alert("まだ開ける項目がありません。もう一度お試しください。");
  }
});

nextBtn.addEventListener('click', () => { if (timer) { clearInterval(timer); timer = null; } showOne().then(setupIntervalFromSelect); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });
genreSel.addEventListener('change', () => { if (timer) { clearInterval(timer); timer = null; } showOne().then(setupIntervalFromSelect); });

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'o') { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); }
  if (e.key.toLowerCase() === 'n') { if (timer) { clearInterval(timer); timer = null; } showOne().then(setupIntervalFromSelect); }
});

function setupIntervalFromSelect() {
  if (timer) { clearInterval(timer); timer = null; }
  const val = parseInt(intervalSel.value, 10);
  if (val > 0) timer = setInterval(showOne, val);
}

showOne().then(setupIntervalFromSelect);

// PWA: SW登録 & 更新（localhost/HTTPSのみ）
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(err => log("SW register error:", err));
} else {
  console.warn("Service Workerは https:// または http://localhost でのみ有効です。");
}
