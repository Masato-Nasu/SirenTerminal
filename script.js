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



// === v19.17 CORS fix: switch to MediaWiki Action API (origin=*) =============
// UIはそのまま。REST /page/related でCORSになる環境向けに、Action APIへ切替。
(function(){
  const titleEl = document.getElementById("titleBox") || document.getElementById("title") || document.querySelector(".title");
  const blurbEl = document.getElementById("blurbBox") || document.getElementById("blurb") || document.querySelector(".blurb");
  const NG_TEXT = "候補が見つかりません";

  // --- generic fetch with retries ---
  async function fetchJSON_A(url, {retries=3, timeout=8000} = {}){
    let last=null;
    for (let a=0;a<=retries;a++){
      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), timeout);
      try{
        const r = await fetch(url + (url.includes('?')?'&':'?') + '_=' + Date.now(), {
          cache:"no-store", signal: ctrl.signal
        });
        clearTimeout(timer);
        const ct = (r.headers.get('content-type')||'').toLowerCase();
        if (!r.ok || !ct.includes('application/json')) throw new Error('bad '+r.status);
        return await r.json();
      }catch(e){
        clearTimeout(timer);
        last=e;
        await new Promise(res=>setTimeout(res, 350*(a+1)));
      }
    }
    return null;
  }

  // --- Action API helpers (CORS: origin=*) ---
  function enc(t){ return encodeURIComponent(t).replace(/%20/g,'_'); }

  async function apiSummary(title){
    // extracts (intro) as summary
    const url = `https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext&exintro&titles=${enc(title)}&format=json&origin=*`;
    const j = await fetchJSON_A(url);
    if (!j || !j.query || !j.query.pages) return null;
    const pages = j.query.pages;
    const k = Object.keys(pages)[0];
    const p = pages[k];
    return p && p.extract ? { title: p.title || title, extract: p.extract } : null;
  }

  async function apiRelated(title, limit=12){
    // CirrusSearch morelike search for "related"
    const url = `https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent('morelike:"'+title+'"')}&srlimit=${limit}&format=json&origin=*`;
    const j = await fetchJSON_A(url);
    if (!j || !j.query || !j.query.search) return [];
    // Map into {title, extract} using a second summary fetch in parallel (best-effort)
    const titles = j.query.search.map(x=>x.title).filter(Boolean);
    const out = [];
    // Try to get short extracts for each (parallel but limited)
    const batch = titles.slice(0, limit);
    for (const t of batch){
      const s = await apiSummary(t);
      out.push({ title: t, extract: s?.extract || "" });
    }
    return out;
  }

  // --- Queue (reuse v19.16 logic but call apiRelated/apiSummary) ---
  function jget(k,d){ try{ return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; }catch{return d;} }
  function jset(k,v){ localStorage.setItem(k, JSON.stringify(v)); }

  const Q_KEY = "siren_v19_17_queue";
  const SEEN_KEY = "siren_v19_17_seen";
  const SEEDS_KEY = "siren_v19_17_seeds";
  const LAST_KEY = "siren_v19_17_last";
  const MAX_QUEUE = 64;
  const MIN_REFILL = 16;
  const SEEN_LIMIT = 1200;
  const SEED_RING = 8;

  function nowTitleFromUI(){ return (titleEl?.textContent || "").replace(/[【】]/g,"").trim(); }
  function rememberTitle(t){
    if (!t) return;
    jset(LAST_KEY, t);
    const seeds = jget(SEEDS_KEY, []);
    if (seeds[seeds.length-1] !== t){ seeds.push(t); }
    jset(SEEDS_KEY, seeds.slice(-SEED_RING));
  }
  function seedCandidates(){
    const s = jget(SEEDS_KEY, []);
    const last = jget(LAST_KEY, "");
    const arr = [];
    const ui = nowTitleFromUI(); if (ui) arr.push(ui);
    if (last) arr.push(last);
    for (const x of s) if (!arr.includes(x)) arr.push(x);
    if (arr.length===0) arr.push("月");
    return arr.slice(-SEED_RING).reverse();
  }

  function pushSeen(t){
    if (!t) return;
    const seen = new Set(jget(SEEN_KEY, [])); seen.add(t);
    const arr = Array.from(seen);
    if (arr.length > SEEN_LIMIT) jset(SEEN_KEY, arr.slice(-Math.floor(SEEN_LIMIT*0.6)));
    else jset(SEEN_KEY, arr);
  }
  function isSeen(t){ return jget(SEEN_KEY, []).includes(t); }

  function loadQ(){ return jget(Q_KEY, []); }
  function saveQ(q){ jset(Q_KEY, q.slice(0, MAX_QUEUE)); }
  function enqueue(items){
    const q = loadQ();
    for (const it of items){
      const t = it?.title; if (!t) continue;
      if (isSeen(t)) continue;
      if (q.find(x=>x.title===t)) continue;
      q.push({ title: t, extract: (it.extract||"") });
      if (q.length >= MAX_QUEUE) break;
    }
    saveQ(q);
  }
  function dequeue(){ const q = loadQ(); const it = q.shift(); saveQ(q); return it || null; }

  async function refill(){
    const seeds = seedCandidates();
    for (const s of seeds){
      const rel = await apiRelated(s, 12);
      if (rel.length) enqueue(rel);
      else {
        const sum = await apiSummary(s);
        if (sum) enqueue([sum]);
      }
      if (loadQ().length >= MIN_REFILL) break;
    }
    if (loadQ().length === 0){
      const base = seeds[0];
      const sum = await apiSummary(base);
      if (sum) enqueue([sum]);
    }
  }
  async function ensureQ(){ if (loadQ().length < MIN_REFILL) await refill(); }

  function paint(it){
    if (!it) return;
    if (titleEl) titleEl.textContent = `【 ${it.title} 】`;
    if (blurbEl) blurbEl.textContent = it.extract || "";
    pushSeen(it.title); rememberTitle(it.title);
  }

  async function serve(){
    const txt = (blurbEl?.textContent || "").trim();
    if (!txt || txt.includes(NG_TEXT)){
      await ensureQ();
      let it = dequeue();
      if (!it){ await refill(); it = dequeue(); }
      if (it) paint(it);
    }else{
      const t = nowTitleFromUI(); if (t) { pushSeen(t); rememberTitle(t); }
    }
  }

  function hook(){
    setTimeout(serve, 60);
    ["nextBtn","next","relBtn","relatedBtn"].forEach(id=>{
      const el = document.getElementById(id); if (el) el.addEventListener("click", ()=> setTimeout(serve, 40));
    });
    const mo = new MutationObserver(()=> setTimeout(serve, 10));
    mo.observe(document.body, { childList:true, characterData:true, subtree:true });
    setInterval(()=>{ ensureQ(); }, 3000);
  }
  if (document.readyState === "loading"){ document.addEventListener("DOMContentLoaded", hook, {once:true}); }
  else { hook(); }
})();
// === end v19.17 =============================================================
