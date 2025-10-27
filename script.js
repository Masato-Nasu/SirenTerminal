// v21: title-pool with refill, exponential backoff, per-launch salt to reshuffle each app start
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
const SEEN_KEY = "siren_seen_titles_v21";
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));

// --- helpers ---
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
  let s = sessionStorage.getItem('siren_launch_salt_v21');
  if (!s){
    s = String(crypto.getRandomValues(new Uint32Array(2))[0] ^ Date.now());
    sessionStorage.setItem('siren_launch_salt_v21', s);
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
  return { title, blurb, detail, url };
}

// --- fetch utilities with backoff ---
async function withBackoff(fn, tries=5){
  let lastErr;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch(e){ lastErr=e; await new Promise(r=>setTimeout(r, Math.min(1600, 200*Math.pow(2,i)))); }
  }
  throw lastErr;
}

async function fetchCategoryBatch(catTitle, cmcontinue=""){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:"+catTitle) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cmcontinue ? "&cmcontinue="+encodeURIComponent(cmcontinue) : "");
  const data = await withBackoff(()=>fetchJSON(url));
  const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
  const cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
  return { titles: members.map(m=>m.title), cont };
}

async function getTitlesByGenre(genre, seed){
  let cont = "";
  let collected = [];
  for (let i=0;i<3;i++){
    const r = await fetchCategoryBatch(genre, cont);
    collected = collected.concat(r.titles);
    cont = r.cont;
    if (!cont) break;
  }
  if (!collected.length) return [];
  shuffleWithSeed(collected, seed);
  return collected;
}

async function getRandomTitles(limit=160){
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
      return { title, blurb:"（概要取得に失敗）", detail:"（詳細取得に失敗）", url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(title) };
    }
  }
}

async function fetchRelatedRobust(title) {
  try { const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title))); const r = (d.pages || []).map(p => normalizeSummary(p)); if (r && r.length) return r; } catch(e){}
  try { const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent('morelike:"' + title + '"') + "&srlimit=7&srnamespace=0&origin=*")); const hits = (d.query && d.query.search) ? d.query.search : []; const titles = hits.map(h => h.title).filter(Boolean); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=parse&format=json&page=" + encodeURIComponent(title) + "&prop=links&origin=*")); const links = (d.parse && d.parse.links) ? d.parse.links : []; const titles = links.filter(l => l.ns===0 && l['*']).slice(0, 10).map(l => l['*']); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles=" + encodeURIComponent(title) + "&origin=*")); const pages = d.query && d.query.pages ? Object.values(d.query.pages) : []; const cats = pages.length ? (pages[0].categories || []) : []; if (cats.length){ const cat = cats[0].title; const d2 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent(cat) + "&cmtype=page&cmnamespace=0&cmlimit=7&origin=*")); const members = (d2.query && d2.query.categorymembers) ? d2.query.categorymembers : []; const titles = members.map(m => m.title).filter(Boolean); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } } catch(e){}
  return [];
}

// --- UI helpers ---
function showMain(){ maintext.hidden = false; altview.hidden = true; backBtn.hidden = true; }
function showAlt(html){ altview.innerHTML = html; maintext.hidden = true; altview.hidden = false; backBtn.hidden = false; }
function renderMain(s){ titleBox.textContent = `【 ${s.title} 】`; blurbBox.textContent = s.blurb; showMain(); }

// --- Title Pool ---
let pool = [];
let fetching = false;

async function refillPool(minNeeded = 120){
  if (fetching) return;
  fetching = true;
  try{
    const g = (genreSel && genreSel.value) ? genreSel.value : "all";
    const seed = await timeSeed();

    let titles = [];
    if (g === "all" || !g){
      titles = await getRandomTitles(180);
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
  if (pool.length < 10) await refillPool(160);
  let title = null;
  while (pool.length){
    const t = pool.shift();
    if (!seenSet.has(t)){ title = t; break; }
  }
  if (!title){
    await refillPool(180);
    if (!pool.length) return null;
    title = pool.shift();
  }
  const s = await fetchSummaryByTitle(title);
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

// --- events ---
if (detailBtn) detailBtn.addEventListener('click', () => {
  if (!current) return;
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});
if (relatedBtn) relatedBtn.addEventListener('click', async () => {
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
  await refillPool(160);
  showOne();
})();

// SW登録
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch(()=>{});
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
