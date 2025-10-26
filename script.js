// v18.5: Center Panel UI + 18.4a engine
const titlebar = document.getElementById('titlebar');
const genreSel = document.getElementById('genreSel');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const banBtn = document.getElementById('banBtn');
const clearBtn = document.getElementById('clearBtn');
const relatedList = document.getElementById('relatedList');
const detailBox = document.getElementById('detail');

// ===== simple kaleidoscope-like viz =====
const canvas = document.getElementById('viz');
const ctx = canvas.getContext('2d');
let t0 = performance.now();
function vizStep(){
  const t = (performance.now()-t0)/1000;
  const W = canvas.width, H = canvas.height;
  const img = ctx.createImageData(W,H);
  for (let y=0; y<H; y++){
    for (let x=0; x<W; x++){
      const i = (y*W+x)*4;
      const nx = (x/W-0.5), ny = (y/H-0.5);
      const r = Math.hypot(nx,ny);
      const ang = Math.atan2(ny,nx);
      const k = Math.sin(12*ang) * Math.cos(40*(r+t*0.05)) + Math.sin(10*(nx*nx-ny*ny)+t*0.8);
      const g = Math.floor((k*0.5+0.5)*255);
      img.data[i]=img.data[i+1]=img.data[i+2]=g; img.data[i+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
  requestAnimationFrame(vizStep);
}
requestAnimationFrame(vizStep);

// ====== engine (from 18.4a) ======
let current = null;
let inSession = [];
const SESSION_LIMIT = 500;
const SEEN_LIMIT = 30000;
const SEEN_KEY = "siren_seen_titles_v18_5_set";
const LAST_KEY = "siren_last_title_v18_5";
const CURSOR_KEY_ALL = "siren_cursor_allpages_v18_5";
const CURSOR_KEY_CAT_PREFIX = "siren_cursor_cat_v18_5_";
const SEED_RING_PREFIX = "siren_seed_ring_v18_5_";
const BAN_KEY = "siren_ban_titles_v18_5_set";
const SEED_RING_SIZE = 64;
const RECENT_EXCLUDE = 200;
let recentQueue = [];

function loadJSON(key, fallback){ try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function saveJSON(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

let seenSet = new Set(loadJSON(SEEN_KEY, []));
let banSet = new Set(loadJSON(BAN_KEY, []));
let lastTitle = (localStorage.getItem(LAST_KEY) || "");

function saveSeen(){
  try {
    if (seenSet.size > SEEN_LIMIT){
      const keep = Array.from(seenSet).slice(-SEEN_LIMIT);
      seenSet = new Set(keep);
    }
    saveJSON(SEEN_KEY, Array.from(seenSet));
  } catch {}
}
function saveBan(){ saveJSON(BAN_KEY, Array.from(banSet)); }
function saveLast(t){ try { localStorage.setItem(LAST_KEY, t || ""); } catch {} }
function getCursorKeyForGenre(genre){ return genre === "all" ? CURSOR_KEY_ALL : (CURSOR_KEY_CAT_PREFIX + genre); }
function loadCursor(genre){ return localStorage.getItem(getCursorKeyForGenre(genre)) || ""; }
function saveCursor(genre, cont){ localStorage.setItem(getCursorKeyForGenre(genre), cont || ""); }
function loadSeedRing(genre){ return loadJSON(SEED_RING_PREFIX + genre, []); }
function saveSeedRing(genre, arr){ saveJSON(SEED_RING_PREFIX + genre, arr.slice(-SEED_RING_SIZE)); }

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
  const blurb = data.description ? `──${data.description}` : (data.extract ? ("──" + data.extract.split("。")[0] + "。") : "──（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}
async function newSeedFor(genre){
  const rnd = crypto.getRandomValues(new Uint32Array(4));
  const parts = [Date.now().toString(16),(performance.now()*1000|0).toString(16),navigator.userAgent||"",rnd.join("-"),Math.random().toString(16)].join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  const dv = new DataView(buf);
  const seed = (BigInt(dv.getUint32(0))<<32n)|BigInt(dv.getUint32(4));
  const ring = loadSeedRing(genre);
  const hex = seed.toString(16);
  if (!ring.includes(hex)){ ring.push(hex); saveSeedRing(genre, ring); return seed; }
  return seed ^ BigInt( (Math.random()*0xffff)|0 );
}
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return((t^t>>>14)>>>0)/4294967296; } }
function shuffleWithSeed(arr, seedBig, salt=0){
  const seedLow = Number((seedBig + BigInt(salt)) & 0xffffffffn) || 1;
  const rand = mulberry32(seedLow);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
async function hash32(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return new DataView(buf).getUint32(0);
}

function pushRecent(title){
  recentQueue.push(title);
  if (recentQueue.length > RECENT_EXCLUDE) recentQueue = recentQueue.slice(-RECENT_EXCLUDE);
}

function acceptableTitle(title){
  if (banSet.has(title)) return false;
  if (title === lastTitle) return false;
  if (inSession.includes(title)) return false;
  if (seenSet.has(title)) return false;
  if (recentQueue.includes(title)) return false;
  return true;
}

async function stepCategory(genre, seedBig){
  let cont = "";
  const steps = Number((seedBig & 0xffn) % 9n) + 1;
  for (let s=0; s<steps; s++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:" + genre) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
    if (!cont) break;
  }
  return cont;
}
async function nextFromCategory(genre, seedBig){
  let cont = await stepCategory(genre, seedBig);
  for (let page=0; page<3; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:" + genre) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
    const salts = await Promise.all(members.map(m => hash32(m.title)));
    const idxs = members.map((_,i)=>i);
    shuffleWithSeed(idxs, seedBig, salts.reduce((a,b)=>a+b,0));
    for (const idx of idxs){
      const title = members[idx].title;
      if (!acceptableTitle(title)) continue;
      saveCursor(genre, (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
    if (!cont){ saveCursor(genre,""); inSession=[]; }
  }
  return null;
}
async function nextFromAllpages(seedBig){
  let cont = "";
  const steps = Number((seedBig & 0x3ffn) % 9n) + 1;
  for (let s=0; s<steps; s++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=allpages&apnamespace=0&aplimit=100&origin=*" + (cont ? "&apcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    cont = (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "";
    if (!cont) break;
  }
  for (let page=0; page<3; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=allpages&apnamespace=0&aplimit=100&origin=*" + (cont ? "&apcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const pages = (data.query && data.query.allpages) ? data.query.allpages : [];
    const salts = await Promise.all(pages.map(p => hash32(p.title)));
    const idxs = pages.map((_,i)=>i);
    shuffleWithSeed(idxs, seedBig, salts.reduce((a,b)=>a+b,0));
    for (const idx of idxs){
      const title = pages[idx].title;
      if (!acceptableTitle(title)) continue;
      saveCursor("all", (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "";
    if (!cont){ saveCursor("all",""); inSession=[]; }
  }
  return null;
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

// science mix
function pickScienceMix(seedBig){
  const cats = ["科学","数学","技術"];
  const idxs = shuffleWithSeed([0,1,2], seedBig);
  return cats[idxs[0]];
}

async function pickNext(){
  const g = genreSel.value;
  const seed = await newSeedFor(g);
  if (g === "all"){
    const GENRES = ["哲学","科学","数学","技術","芸術","言語学","心理学","歴史","文学"];
    const idxs = shuffleWithSeed([...Array(GENRES.length).keys()], seed);
    for (const i of idxs){
      const t = await nextFromCategory(GENRES[i], seed + BigInt(i));
      if (t) return await fetchSummaryByTitle(t);
    }
    const t2 = await nextFromAllpages(seed);
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  } else if (g === "科学"){
    const cat = pickScienceMix(seed);
    const t = await nextFromCategory(cat, seed);
    if (t) return await fetchSummaryByTitle(t);
    const t2 = await nextFromAllpages(seed);
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  } else {
    const t = await nextFromCategory(g, seed);
    if (t) return await fetchSummaryByTitle(t);
    const t2 = await nextFromAllpages(seed);
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  }
}

function renderMain(s){
  titlebar.textContent = `【 ${s.title} 】 ${s.blurb.replace(/^──/,'— ')}`;
  relatedList.innerHTML = "";
  detailBox.textContent = "";
}

async function showOne(){
  const s = await pickNext();
  if (!s){
    titlebar.textContent = "候補が見つかりません。ジャンルを変えるか時間をおいて再試行してください。";
    return;
  }
  current = s;
  lastTitle = s.title; saveLast(lastTitle);
  seenSet.add(s.title); saveSeen();
  inSession.push(s.title); if (inSession.length > SESSION_LIMIT) inSession = inSession.slice(-SESSION_LIMIT);
  pushRecent(s.title);
  renderMain(s);
}

detailBtn.addEventListener('click', () => {
  if (!current) return;
  detailBox.textContent = `${current.detail}\n\n[WIKI] ${current.url}`;
});
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  relatedList.innerHTML = `<li>loading…</li>`;
  try {
    const rel = await fetchRelatedRobust(current.title);
    if (!rel.length){ relatedList.innerHTML = `<li>(no items)</li>`; return; }
    relatedList.innerHTML = "";
    rel.slice(0,7).forEach((p,i)=>{
      const li = document.createElement('li');
      li.innerHTML = `[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${p.title}</a>`;
      relatedList.appendChild(li);
    });
  } catch(e){
    relatedList.innerHTML = `<li>(failed)</li>`;
  }
});
openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});
nextBtn.addEventListener('click', () => { showOne(); });
banBtn.addEventListener('click', () => { if (!current) return; banSet.add(current.title); saveBan(); showOne(); });
clearBtn.addEventListener('click', () => { detailBox.textContent = ""; relatedList.innerHTML = ""; });

setTimeout(()=>{ showOne(); }, 700);

if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
}
