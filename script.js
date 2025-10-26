const output = document.getElementById('output');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const intervalSel = document.getElementById('intervalSel');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');

let timer = null;
let current = null;
const historyBuf = [];

function typeWriter(text, speed = 26) {
  return new Promise(resolve => {
    let i = 0;
    const step = () => {
      if (i < text.length) {
        output.textContent += text.charAt(i++);
        setTimeout(step, speed);
      } else resolve();
    };
    step();
  });
}

async function fetchRandomSummary() {
  const url = "https://ja.wikipedia.org/api/rest_v1/page/random/summary";
  const res = await fetch(url, { mode: "cors", headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error("Wikipedia fetch failed: " + res.status);
  const data = await res.json();
  return normalizeSummary(data);
}

function normalizeSummary(data) {
  const title = data.title || "（無題）";
  const blurb = data.description ? `──${data.description}` : (data.extract ? ("──" + data.extract.split("。")[0] + "。") : "──（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}

async function fetchRelated(title) {
  const url = "https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title);
  const res = await fetch(url, { mode: "cors", headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error("Wikipedia related fetch failed: " + res.status);
  const data = await res.json();
  const pages = (data.pages || []).map(p => normalizeSummary(p));
  return pages;
}

async function showRandomFromWikipedia() {
  try {
    current = await fetchRandomSummary();
    historyBuf.push(current);
    if (historyBuf.length > 50) historyBuf.shift();
    output.textContent = "";
    await typeWriter(`今日の概念：${current.title}\n\n`);
    await typeWriter(`${current.blurb}`);
  } catch (err) {
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
    if (!rel.length) {
      output.textContent += `\n- （関連なし）`;
      return;
    }
    output.textContent += "\n";
    rel.slice(0, 5).forEach((p) => {
      output.textContent += `- ${p.title}\n`;
    });
    output.textContent += `\n（関連のいずれかを次の更新で自動取得します）`;
  } catch(e) {
    output.textContent += `\n- （関連取得に失敗しました）`;
  }
});

nextBtn.addEventListener('click', () => {
  if (timer) { clearInterval(timer); timer = null; }
  showRandomFromWikipedia().then(setupIntervalFromSelect);
});

clearBtn.addEventListener('click', () => { output.textContent = ""; });

function setupIntervalFromSelect() {
  if (timer) { clearInterval(timer); timer = null; }
  const val = parseInt(intervalSel.value, 10);
  if (val > 0) timer = setInterval(showRandomFromWikipedia, val);
}
intervalSel.addEventListener('change', setupIntervalFromSelect);

showRandomFromWikipedia().then(setupIntervalFromSelect);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => {
    if (reg && reg.update) reg.update();
  }).catch(()=>{});
}
