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



// === v19.15 Related-Only Crawler Queue (UI非変更) ===========================
// 目的: 24個目で枯渇しないアルゴリズムに変更（ランダム禁止、関連のみ）
(function(){
  const NG_TEXT = "候補が見つかりません";
  const titleEl = document.getElementById("titleBox") || document.getElementById("title") || document.querySelector(".title");
  const blurbEl = document.getElementById("blurbBox") || document.getElementById("blurb") || document.querySelector(".blurb");

  const Q_KEY = "siren_v19_15_queue";
  const SEEN_KEY = "siren_v19_15_seen";
  const LAST_TITLE_KEY = "siren_v19_15_last_title";
  const MAX_QUEUE = 48;     // 十分なプール
  const MIN_REFILL = 12;    // 下回ったら補充
  const SEEN_LIMIT = 800;   // 永久に膨らまないように制限

  function jget(k,d){ try{ return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; }catch{return d;} }
  function jset(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

  function nowTitleFromUI(){
    return (titleEl?.textContent || "").replace(/[【】]/g,"").trim();
  }
  function currentSeed(){
    const ui = nowTitleFromUI();
    if (ui) return ui;
    const last = jget(LAST_TITLE_KEY, "");
    if (last) return last;
    return "月"; // 安全な既定シード
  }
  function rememberTitle(t){
    if (t) jset(LAST_TITLE_KEY, t);
  }

  function pushSeen(title){
    if (!title) return;
    const seen = new Set(jget(SEEN_KEY, []));
    seen.add(title);
    const arr = Array.from(seen);
    // サイズ制御（新しい方を残す）
    if (arr.length > SEEN_LIMIT){
      jset(SEEN_KEY, arr.slice(-Math.floor(SEEN_LIMIT*0.6)));
    }else{
      jset(SEEN_KEY, arr);
    }
  }
  function isSeen(title){
    const seen = jget(SEEN_KEY, []);
    return seen.includes(title);
  }

  function loadQueue(){ return jget(Q_KEY, []); }
  function saveQueue(q){ jset(Q_KEY, q.slice(0, MAX_QUEUE)); }
  function enqueue(items){
    const q = loadQueue();
    for (const it of items){
      if (!it?.title) continue;
      if (isSeen(it.title)) continue;
      if (q.find(x=>x.title===it.title)) continue;
      q.push({ title: it.title, extract: it.extract || it.blurb || it.detail || "" });
      if (q.length >= MAX_QUEUE) break;
    }
    saveQueue(q);
  }
  function dequeue(){
    const q = loadQueue();
    const it = q.shift();
    saveQueue(q);
    return it || null;
  }

  async function fetchJSONsafe(url){
    try{
      const r = await fetch(url + (url.includes('?')?'&':'?') + '_=' + Date.now(), { headers:{'Accept':'application/json'}, cache:'no-store' });
      const ct = (r.headers.get('content-type')||'').toLowerCase();
      if(!r.ok || !ct.includes('application/json')) throw new Error('bad');
      return await r.json();
    }catch{ return null; }
  }

  async function refillFrom(seedTitle){
    const seed = seedTitle || currentSeed();
    const qseed = encodeURIComponent(seed);
    // 1) related(seed) を取得
    const rel = await fetchJSONsafe(`https://ja.wikipedia.org/api/rest_v1/page/related/${qseed}`);
    const pages = (rel && rel.pages) ? rel.pages : [];
    enqueue(pages);
    // 2) キューが薄い場合は related() の先頭候補をさらに展開（BFS 2層）
    if (loadQueue().length < MIN_REFILL && pages.length){
      const hop = pages.slice(0,6); // 最大6件の見出しで展開
      for (const p of hop){
        const t = encodeURIComponent(p.title);
        const rel2 = await fetchJSONsafe(`https://ja.wikipedia.org/api/rest_v1/page/related/${t}`);
        const pages2 = (rel2 && rel2.pages) ? rel2.pages : [];
        enqueue(pages2);
        if (loadQueue().length >= MAX_QUEUE) break;
      }
    }
    // 3) それでも空なら seed の summary を入れておく（必ず出せる）
    if (loadQueue().length === 0){
      const sum = await fetchJSONsafe(`https://ja.wikipedia.org/api/rest_v1/page/summary/${qseed}`);
      if (sum){
        enqueue([{ title: sum.title || seed, extract: sum.extract || "" }]);
      }
    }
  }

  async function ensureQueue(){
    if (loadQueue().length < MIN_REFILL){
      await refillFrom(currentSeed());
    }
  }

  function paint(item){
    if (!item) return;
    if (titleEl) titleEl.textContent = `【 ${item.title} 】`;
    if (blurbEl) blurbEl.textContent = (item.extract || "");
    pushSeen(item.title);
    rememberTitle(item.title);
  }

  async function showFromQueue(){
    // 確実に何かを出す
    await ensureQueue();
    let it = dequeue();
    if (!it){
      await refillFrom(currentSeed());
      it = dequeue();
    }
    if (it){
      paint(it);
      return true;
    }
    return false;
  }

  async function guardAndServe(){
    const txt = (blurbEl?.textContent || "").trim();
    if (!txt || txt.includes(NG_TEXT)){
      await showFromQueue();
    }else{
      const t = nowTitleFromUI();
      if (t) { pushSeen(t); rememberTitle(t); }
    }
  }

  // 初回＆クリック後＆DOM更新ごとに guard
  function hook(){
    setTimeout(guardAndServe, 80);
    ["nextBtn","next","relBtn","relatedBtn"].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.addEventListener("click", ()=> setTimeout(guardAndServe, 60));
    });
    const mo = new MutationObserver(()=> setTimeout(guardAndServe, 10));
    mo.observe(document.body, { childList:true, characterData:true, subtree:true });
  }
  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", hook, {once:true});
  }else{
    hook();
  }
})();
// === end v19.15 =============================================================
