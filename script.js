// v18.3: 高エントロピーSeed＋再利用禁止＋seededシャッフル。ジャンル/関連はv18.2相当。

const output = document.getElementById('output');
const genreSel = document.getElementById('genreSel');
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const clearBtn = document.getElementById('clearBtn');
const relatedStatus = document.getElementById('relatedStatus');
const relatedList = document.getElementById('relatedList');

let current = null;
let inSession = [];
const SESSION_LIMIT = 500;
const SEEN_LIMIT = 20000; // 拡張
const SEEN_KEY = "siren_seen_titles_v18_3_set";
const LAST_KEY = "siren_last_title_v18_3";
const CURSOR_KEY_ALL = "siren_cursor_allpages_v18_3";
const CURSOR_KEY_CAT_PREFIX = "siren_cursor_cat_v18_3_";
const ROUND_KEY = "siren_round_robin_idx_v18_3";
const SEED_RING_PREFIX = "siren_seed_ring_v18_3_"; // + genre
const SEED_COUNTER_PREFIX = "siren_seed_counter_v18_3_"; // + genre
const SEED_RING_SIZE = 64;

let seenSet = new Set(loadSeen());
let lastTitle = loadLast();

function loadSeen(){ try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch { return []; } }
function saveSeen(){
  try {
    if (seenSet.size > SEEN_LIMIT){
      const keep = Array.from(seenSet).slice(-SEEN_LIMIT);
      seenSet = new Set(keep);
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seenSet)));
  } catch {}
}
function loadLast(){ try { return localStorage.getItem(LAST_KEY) || ""; } catch { return ""; } }
function saveLast(t){ try { localStorage.setItem(LAST_KEY, t || ""); } catch {} }
function getCursorKeyForGenre(genre){ return genre === "all" ? CURSOR_KEY_ALL : (CURSOR_KEY_CAT_PREFIX + genre); }
function loadCursor(genre){ try { return localStorage.getItem(getCursorKeyForGenre(genre)) || ""; } catch { return ""; } }
function saveCursor(genre, cont){ try { localStorage.setItem(getCursorKeyForGenre(genre), cont || ""); } catch {} }
function getRound(){ try { return parseInt(localStorage.getItem(ROUND_KEY) || "0", 10) || 0; } catch { return 0; } }
function setRound(v){ try { localStorage.setItem(ROUND_KEY, String(v)); } catch {} }

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

// ===== 高エントロピーSeed生成 & 再利用禁止 =====
function loadSeedRing(genre){
  try { return JSON.parse(localStorage.getItem(SEED_RING_PREFIX + genre) || "[]"); } catch { return []; }
}
function saveSeedRing(genre, arr){
  try { localStorage.setItem(SEED_RING_PREFIX + genre, JSON.stringify(arr.slice(-SEED_RING_SIZE))); } catch {}
}
function nextSeedCounter(genre){
  try {
    const k = SEED_COUNTER_PREFIX + genre;
    const n = parseInt(localStorage.getItem(k) || "0", 10) || 0;
    localStorage.setItem(k, String(n+1));
    return n+1;
  } catch { return Math.floor(Math.random()*1e9); }
}
async function genHighEntropySeed(genre){
  const rnd = crypto.getRandomValues(new Uint32Array(4)); // 128bit
  const parts = [
    Date.now().toString(16),
    (performance.now()*1000|0).toString(16),
    navigator.userAgent || "",
    rnd[0].toString(16)+rnd[1].toString(16)+rnd[2].toString(16)+rnd[3].toString(16),
    String(nextSeedCounter(genre))
  ].join("|");
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(parts));
  const dv = new DataView(buf);
  // 64bitに圧縮
  const hi = BigInt(dv.getUint32(0)) << 32n | BigInt(dv.getUint32(4));
  return hi; // BigInt
}
async function uniqueSeed(genre){
  const ring = loadSeedRing(genre);
  for (let tries=0; tries<5; tries++){
    const s = await genHighEntropySeed(genre);
    const hex = s.toString(16);
    if (!ring.includes(hex)){
      ring.push(hex);
      saveSeedRing(genre, ring);
      return s;
    }
  }
  // どうしても被るなら最後を少しずらす
  const s = await genHighEntropySeed(genre);
  return s ^ BigInt(Math.floor(Math.random()*0xffff));
}

// ===== PRNG（mulberry32）でシャッフル =====
function mulberry32(a){
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
function shuffleWithSeed(arr, seedBig){
  const seedLow = Number(seedBig & 0xffffffffn) || 1;
  const rand = mulberry32(seedLow);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== APIラッパ（allpages / categorymembers） =====
async function nextFromAllpages(seedBig){
  let cont = loadCursor("all");
  for (let page=0; page<20; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=allpages&apnamespace=0&aplimit=100&origin=*" + (cont ? "&apcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const pages = (data.query && data.query.allpages) ? data.query.allpages : [];
    const idxs = shuffleWithSeed(Array.from({length:pages.length}, (_,i)=>i), seedBig + BigInt(page));
    for (const idx of idxs){
      const title = pages[idx].title;
      if (title === lastTitle) continue;
      if (inSession.includes(title)) continue;
      if (seenSet.has(title)) continue;
      saveCursor("all", (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.apcontinue) ? data.continue.apcontinue : "";
    saveCursor("all", cont);
    if (!cont){ saveCursor("all",""); inSession = []; }
  }
  return null;
}

async function nextFromCategory(genre, seedBig){
  let cont = loadCursor(genre);
  for (let page=0; page<20; page++){
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:" + genre) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cont ? "&cmcontinue=" + encodeURIComponent(cont) : "");
    const data = await fetchJSON(url);
    const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
    const idxs = shuffleWithSeed(Array.from({length:members.length}, (_,i)=>i), seedBig + BigInt(page) + BigInt(genre.codePointAt(0)||0));
    for (const idx of idxs){
      const title = members[idx].title;
      if (title === lastTitle) continue;
      if (inSession.includes(title)) continue;
      if (seenSet.has(title)) continue;
      saveCursor(genre, (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "");
      return title;
    }
    cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
    saveCursor(genre, cont);
    if (!cont){ saveCursor(genre,""); inSession = []; }
  }
  return null;
}

async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return normalizeSummary(data);
}

// ===== 関連：多段フォールバック（v18.2同等） =====
async function fetchRelatedRobust(title) {
  try { const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(title)); const r = (d.pages || []).map(p => normalizeSummary(p)); if (r && r.length) return r; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent('morelike:"' + title + '"') + "&srlimit=7&srnamespace=0&origin=*"); const hits = (d.query && d.query.search) ? d.query.search : []; const titles = hits.map(h => h.title).filter(Boolean); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=parse&format=json&page=" + encodeURIComponent(title) + "&prop=links&origin=*"); const links = (d.parse && d.parse.links) ? d.parse.links : []; const titles = links.filter(l => l.ns===0 && l['*']).slice(0, 10).map(l => l['*']); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=7&namespace=0&origin=*"); const titles = Array.isArray(d) && Array.isArray(d[1]) ? d[1] : []; const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } catch(e){}
  try { const d = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles=" + encodeURIComponent(title) + "&origin=*"); const pages = d.query && d.query.pages ? Object.values(d.query.pages) : []; const cats = pages.length ? (pages[0].categories || []) : []; if (cats.length){ const cat = cats[0].title; const d2 = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent(cat) + "&cmtype=page&cmnamespace=0&cmlimit=7&origin=*"); const members = (d2.query && d2.query.categorymembers) ? d2.query.categorymembers : []; const titles = members.map(m => m.title).filter(Boolean); const out=[]; for (const t of titles){ try{ out.push(await fetchSummaryByTitle(t)); }catch(e){} } if(out.length) return out; } } catch(e){}
  return [];
}

// ===== 選定ロジック =====
async function pickNext(){
  const g = genreSel.value;
  const seed = await uniqueSeed(g); // ジャンル毎に未使用Seedを生成
  if (g === "all"){
    // まず各カテゴリを1つずつ試みる（順番はseedで回転）
    const GENRES = ["哲学","科学","数学","技術","芸術","言語学","心理学","歴史","文学"];
    const rot = Number(seed % BigInt(GENRES.length));
    for (let i=0;i<GENRES.length;i++){
      const cat = GENRES[(i + rot) % GENRES.length];
      const t = await nextFromCategory(cat, seed + BigInt(i));
      if (t) return await fetchSummaryByTitle(t);
    }
    // ダメなら全ページへ
    const t2 = await nextFromAllpages(seed);
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  } else {
    // 特定ジャンルを優先。尽きたときのみ全体へ
    const t = await nextFromCategory(g, seed);
    if (t) return await fetchSummaryByTitle(t);
    const t2 = await nextFromAllpages(seed);
    if (t2) return await fetchSummaryByTitle(t2);
    return null;
  }
}

// ===== UI =====
function renderMain(s){
  output.textContent = `今日の概念：${s.title}\n\n${s.blurb}`;
  relatedList.innerHTML = "";
  relatedStatus.textContent = "";
}
async function showOne(){
  const s = await pickNext();
  if (!s){
    output.textContent = "（候補が見つかりません。ジャンルを変えるか時間をおいて再試行してください）";
    return;
  }
  current = s;
  lastTitle = s.title; saveLast(lastTitle);
  seenSet.add(s.title); saveSeen();
  inSession.push(s.title); if (inSession.length > SESSION_LIMIT) inSession = inSession.slice(-SESSION_LIMIT);
  renderMain(s);
}

detailBtn.addEventListener('click', () => {
  if (!current) return;
  output.textContent += `\n\n[詳細]\n${current.detail}\n\n[出典] ${current.url}`;
});
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  relatedStatus.textContent = "読み込み中…"; relatedList.innerHTML = "";
  try {
    const rel = await fetchRelatedRobust(current.title);
    if (!rel.length){ relatedStatus.textContent = "（見つかりませんでした）"; return; }
    relatedStatus.textContent = `（${rel.length}件）`;
    rel.slice(0,7).forEach((p,i)=>{
      const li = document.createElement('li');
      li.innerHTML = `[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${p.title}</a>`;
      relatedList.appendChild(li);
    });
  } catch(e){
    relatedStatus.textContent = "（取得に失敗しました）";
  }
});
openBtn.addEventListener('click', () => {
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});
nextBtn.addEventListener('click', () => { showOne(); });
clearBtn.addEventListener('click', () => { output.textContent = ""; });

// 起動900ms後に最初の概念
setTimeout(()=>{ showOne(); }, 900);

// PWA登録（静音）
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg => { if (reg && reg.update) reg.update(); }).catch(()=>{});
}
