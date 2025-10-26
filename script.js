// v19.5: robust retry/timeout & safe UI fallbacks
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
const SEEN_KEY = "siren_seen_titles_v19_5";
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));

function loadJSON(key, fallback){ try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function saveJSON(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function saveSeen(){
  if (seenSet.size > SEEN_LIMIT){
    const keep = Array.from(seenSet).slice(-Math.floor(SEEN_LIMIT*0.8));
    seenSet = new Set(keep);
  }
  saveJSON(SEEN_KEY, Array.from(seenSet));
}

async function timeSeed(){
  const nowSec = Math.floor(Date.now()/1000);
  const perf = (performance.now()*1000|0) & 0xffffffff;
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  const str = `${nowSec}|${perf}|${rnd[0]}|${rnd[1]}|${navigator.userAgent}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  const dv = new DataView(buf);
  return (BigInt(dv.getUint32(0))<<32n) | BigInt(dv.getUint32(4));
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

// ---- 追加: タイムアウト & リトライつき fetchJSON ----
async function fetchJSON(url, {timeoutMs=8000, retries=2} = {}){
  let lastErr = null;
  for (let attempt=0; attempt<=retries; attempt++){
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(bust(url), {
        mode: "cors",
        headers: { "Accept": "application/json" },
        cache: "no-store",
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = (res.headers.get('content-type')||'').toLowerCase();
      // 一部のエッジケースで problem+json を返すことがあるため緩めに許可
      if (!ct.includes('application/json')) throw new Error("Non-JSON");
      return await res.json();
    }catch(e){
      clearTimeout(timer);
      lastErr = e;
      // 429/503等は少し待って再試行
      await new Promise(r=>setTimeout(r, 300 + 300*attempt));
    }
  }
  throw lastErr || new Error("fetch failed");
}

function normalizeSummary(data){
  const title = data.title || "（無題）";
  const blurb = data.description ? `${data.description}` : (data.extract ? (data.extract.split("。")[0] + "。") : "（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}

async function fetchCategoryBatch(catTitle, cmcontinue=""){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:"+catTitle) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cmcontinue ? "&cmcontinue="+encodeURIComponent(cmcontinue) : "");
  const data = await fetchJSON(url);
  const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
  const cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
  return { titles: members.map(m=>m.title), cont };
}

async function getTitlesByGenre(genre, seed){
  let cont = "";
  const steps = Number((seed & 0xffn) % 7n) + 1;
  for (let i=0;i<steps;i++){
    const r = await fetchCategoryBatch(genre, cont);
    cont = r.cont;
    if (!cont) break;
  }
  const r2 = await fetchCategoryBatch(genre, cont);
  let titles = r2.titles;
  if (!titles.length) return [];
  shuffleWithSeed(titles, seed);
  return titles;
}
async function getRandomTitles(limit=40){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit="+limit+"&origin=*");
  const arr = (data.query && data.query.random) ? data.query.random : [];
  return arr.map(x => x.title);
}
async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return normalizeSummary(data);
}

async function fetchRelatedRobust(title) {
  try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title)); const r = (d.pages || []).map(p => normalizeSummary(p)); if (r && r.length) return r; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent('morelike:"' + title + '"') + "&srlimit=7&srnamespace=0&origin=*"); const hits = (d.query && d.query.search) ? d.query.search : []; const titles = hits.map(h => h.title).filter(Boolean); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=parse&format=json&page=" + encodeURIComponent(title) + "&prop=links&origin=*"); const links = (d.parse && d.parse.links) ? d.parse.links : []; const titles = links.filter(l => l.ns===0 && l['*']).slice(0, 10).map(l => l['*']); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=7&namespace=0&origin=*"); const titles = Array.isArray(d) && Array.isArray(d[1]) ? d[1] : []; const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles=" + encodeURIComponent(title) + "&origin=*"); const pages = d.query && d.query.pages ? Object.values(d.query.pages) : []; const cats = pages.length ? (pages[0].categories || []) : []; if (cats.length){ const cat = cats[0].title; const d2 = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent(cat) + "&cmtype=page&cmnamespace=0&cmlimit=7&origin=*"); const members = (d2.query && d2.query.categorymembers) ? d2.query.categorymembers : []; const titles = members.map(m => m.title).filter(Boolean); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } } catch(e){}
  return [];
}

function showMain(){
  maintext.hidden = false;
  altview.hidden = true;
  backBtn.hidden = true;
}
function showAlt(html){
  altview.innerHTML = html;
  maintext.hidden = true;
  altview.hidden = false;
  backBtn.hidden = false;
}

// ---- 追加: フォールバックつき pickNew ----
async function pickNew(){
  const g = genreSel.value;
  const seed = await timeSeed();
  let titles = [];
  try{
    if (g === "all"){
      titles = await getRandomTitles(40);
      shuffleWithSeed(titles, seed);
    } else {
      titles = await getTitlesByGenre(g, seed);
    }
  }catch(e){
    // ジャンル取得失敗時はランダムにフォールバック
    titles = await getRandomTitles(40);
    shuffleWithSeed(titles, seed);
  }
  titles = titles.filter(t => !seenSet.has(t));
  let tries=0;
  while (titles.length === 0 && tries < 5){
    tries++;
    try{
      if (g === "all"){
        titles = await getRandomTitles(40);
        shuffleWithSeed(titles, seed + BigInt(tries));
      } else {
        titles = await getTitlesByGenre(g, seed + BigInt(tries));
      }
      titles = titles.filter(t => !seenSet.has(t));
    }catch(e){
      titles = await getRandomTitles(40);
      shuffleWithSeed(titles, seed + BigInt(tries));
      titles = titles.filter(t => !seenSet.has(t));
    }
  }
  if (!titles.length) return null;
  const title = titles[0];
  return await fetchSummaryByTitle(title);
}

// ---- 重要: UIが必ず何か表示されるように try/catch 追加 ----
async function showOne(){
  // 先にプレースホルダーを出して「空白」に見えないように
  titleBox.textContent = "読み込み中…";
  blurbBox.textContent = "接続状況を確認しています";
  showMain();

  try{
    const s = await pickNew();
    if (!s){
      titleBox.textContent = "（候補が見つかりません）";
      blurbBox.textContent = "時間をおいて再試行してください。";
      return;
    }
    current = s;
    seenSet.add(s.title); saveSeen();
    titleBox.textContent = `【 ${s.title} 】`; 
    blurbBox.textContent = s.blurb;
  }catch(e){
    titleBox.textContent = "（取得に失敗しました）";
    blurbBox.textContent = "通信が混み合っています。しばらくしてから MORE / NEXT をお試しください。";
  }finally{
    showMain();
  }
}

detailBtn.addEventListener('click', () => {
  if (!current) return;
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
  try {
    const rel = await fetchRelatedRobust(current.title);
    if (!rel.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
    const items = rel.slice(0,9).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("");
    showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
  } catch(e){
    showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
  }
});
openBtn.addEventListener('click', () => { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); });
nextBtn.addEventListener('click', () => { showOne(); });
backBtn.addEventListener('click', () => { showMain(); });
clearBtn.addEventListener('click', () => { if (!altview.hidden) showMain(); });

setTimeout(()=>{ showOne(); }, 400);

if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch(()=>{});
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}



// === v19.26 SAFE MODE: SW完全無効・依存ゼロで必ず表示（UI非変更） ==================
(function(){
  if (window.__SIREN_V1926_LOADED__) return;
  window.__SIREN_V1926_LOADED__ = true;

  // 0) どの環境でも落ちない SW 無効化（存在しても解除、register を無効化）
  (async () => {
    try {
      if (typeof navigator!=='undefined' && 'serviceWorker' in navigator) {
        try { const regs = await navigator.serviceWorker.getRegistrations(); for (const r of regs) await r.unregister(); } catch {}
        try { navigator.serviceWorker.register = async ()=>({}); } catch {}
      }
    } catch {}
  })();

  const tEl = document.getElementById("titleBox") || document.getElementById("title") || document.querySelector(".title");
  const bEl = document.getElementById("blurbBox") || document.getElementById("blurb") || document.querySelector(".blurb") || document.body;
  const safeText = (v,f="") => (typeof v==="string" && v.trim()) ? v : f;

  // 1) 単発で必ず1件描画（ネット通っていれば Action API、だめなら固定文）
  async function paintOne(baseTitle){
    const base = safeText(baseTitle, "月");
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles='
            + encodeURIComponent(base) + '&format=json&origin=*';
    try{
      const r = await fetch(u, {cache:'no-store'});
      const j = await r.json();
      const pages = j?.query?.pages || {};
      const k = Object.keys(pages)[0] || "";
      const p = pages[k] || {};
      const title = safeText(p.title, base);
      const extract = safeText(p.extract, "（説明文の取得に失敗しました）");
      if (tEl) tEl.textContent = `【 ${title} 】`;
      if (bEl) bEl.textContent = extract;
      return true;
    }catch(_){
      if (tEl) tEl.textContent = `【 ${base} 】`;
      if (bEl) bEl.textContent = "（オフラインのため最小表示のみ）";
      return false;
    }
  }

  // 2) 科学カテゴリからの生成（軽量・依存なし）
  async function fetchScienceBatch(limit=12){
    const sci = "Category:%E8%87%AA%E7%84%B6%E7%A7%91%E5%AD%A6";
    const api = `https://ja.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${sci}&cmtype=page&cmlimit=${limit}&format=json&origin=*`;
    const j = await fetch(api, {cache:'no-store'}).then(r=>r.json()).catch(()=>null);
    const items = [];
    const titles = j?.query?.categorymembers?.map(x=>x.title).filter(Boolean) || [];
    for (const t of titles){
      const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles='
              + encodeURIComponent(t) + '&format=json&origin=*';
      const s = await fetch(u, {cache:'no-store'}).then(r=>r.json()).catch(()=>null);
      const pages = s?.query?.pages || {};
      const k = Object.keys(pages)[0] || "";
      const p = pages[k] || {};
      items.push({ title: safeText(p.title, t), extract: safeText(p.extract, "") });
    }
    return items;
  }

  let queue = []; // ストレージ不使用（毎回クリアでも動く）
  let lock = false;
  function nextFromQueue(){
    while (queue.length){
      const it = queue.shift();
      if (it && it.title) return it;
    }
    return null;
  }
  async function refillIfNeeded(){
    if (queue.length >= 8) return;
    const batch = await fetchScienceBatch(20);
    for (const it of batch){
      if (!queue.find(x=>x.title===it.title)) queue.push(it);
    }
  }

  async function showNext(){
    if (lock) return; lock = true;
    try {
      await refillIfNeeded();
      const it = nextFromQueue();
      if (it){
        const title = safeText(it.title,"");
        const extract = safeText(it.extract,"");
        if (title && extract){
          if (tEl) tEl.textContent = `【 ${title} 】`;
          if (bEl) bEl.textContent = extract;
          return;
        }
      }
      // キューが空/本文空なら単発フォールバック
      const base = safeText((tEl?.textContent||"").replace(/[【】]/g,""), "月");
      await paintOne(base);
    } finally {
      // 最小ロックでフリッカー抑止
      setTimeout(()=>{ lock=false; }, 200);
    }
  }

  // 3) 初期起動：一度描画したら終了（無限監視しない）
  (async () => {
    const had = safeText(bEl?.textContent||"","");
    if (!had) await paintOne(safeText((tEl?.textContent||"").replace(/[【】]/g,""), ""));
    await showNext();
  })();

  // 4) NEXT/RELATED があれば次へ（多重バインド防止）
  ["nextBtn","next","relBtn","relatedBtn"].forEach(id=>{
    const el = document.getElementById(id);
    if (el && !el.__v1926_bound){
      el.__v1926_bound = true;
      el.addEventListener('click', ()=> showNext());
    }
  });
})();
// === end v19.26 SAFE MODE ====================================================
