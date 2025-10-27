
// v21.8.1 UltraLight: always-learning 50%, NO genre UI, tiny pools, memoized summaries, faster timeouts
const titleBox = document.getElementById('title');
const blurbBox = document.getElementById('blurb');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const clearBtn = document.getElementById('clearBtn');
const maintext = document.getElementById('maintext');
const altview = document.getElementById('altview');
const statusEl = document.getElementById('status') || document.querySelector('[data-status]');

// Remove/Hide any genre UI (radios/selects) to reduce confusion & overhead

// --- Aggressive removal of any 'ジャンル' UI (radios, selects, labels, fieldsets) ---
(function removeGenreEverywhere(){
  const selectors = [
    "[id*='genre' i]", "[class*='genre' i]", "input[name*='genre' i]",
    "fieldset", "section", "div", "label", "ul", "ol", "form"
  ];
  for (const sel of selectors){
    for (const el of Array.from(document.querySelectorAll(sel))){
      const txt = (el.textContent||"") + " " + (el.getAttribute("aria-label")||"") + " " + (el.getAttribute("name")||"") + " " + (el.id||"") + " " + (el.className||"");
      if (/ジャンル|genre/i.test(txt)){
        el.remove();
      }
    }
  }
})();
(function removeGenreUI(){
  const byId = ['genreSel','genre','genres','radio-genre'];
  for (const id of byId){ const el = document.getElementById(id); if (el) el.remove(); }
  // hide any fieldset/label containing "ジャンル"
  const nodes = Array.from(document.querySelectorAll('fieldset,section,div,label'));
  for (const n of nodes){ if (n.textContent && n.textContent.includes('ジャンル')) n.style.display='none'; }
})();

let current = null;
const SEEN_KEY = "siren_seen_titles_v21_8_1";
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));

// Profile (always-on learning)
const PROFILE_KEY = "siren_profile_v21_8_1";
let profile = loadJSON(PROFILE_KEY, { tags:{}, lastLearn:0 });
function saveProfile(){ saveJSON(PROFILE_KEY, profile); }
function bumpTag(t, w=1){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; profile.lastLearn=Date.now(); saveProfile(); }
function topTags(n=20){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }
function decayProfile(f = 0.999){ for (const k in profile.tags) profile.tags[k]*=f; for (const k of Object.keys(profile.tags)) if (profile.tags[k] < 0.12) delete profile.tags[k]; saveProfile(); }
setInterval(()=>decayProfile(0.9997), 60*1000);

// Salted randomness (always different)
let pickCounter = 0n;
function saltedRandSeed(){
  const s = sessionSalt() ^ BigInt(Date.now() >>> 0) ^ (pickCounter++);
  return s;
}

// Status
function setStatus(txt){ if (statusEl) statusEl.textContent = txt; }

function // Pool (tiny) & selection
let pool = [];
let fetching = false;

async function fetchRandomBatch(n=40){
  try {
    const data = await withBackoff(()=>fetchJSON(
      "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit="+n+"&origin=*",
      {timeout: 4000}
    ));
    const arr = (data.query && data.query.random) ? data.query.random : [];
    if (arr.length) return arr.map(x => x.title);
  } catch(e){}
  const seed = saltedRandSeed();
  return shuffleWithSeed(LOCAL_SEED.slice(), seed).slice(0, n);
}

async function refillPool(minNeeded = 40){
  if (fetching) return;
  fetching = true;
  try{
    setStatus('起動中…候補を収集中');
    const titles = await fetchRandomBatch(50);
    const seed = saltedRandSeed();
    const add = shuffleWithSeed(titles.filter(t => !seenSet.has(t)), seed);
    const exist = new Set(pool);
    for (const t of add){
      if (!exist.has(t)) pool.push(t);
      if (pool.length >= minNeeded) break;
    }
  } finally {
    fetching = false;
    setStatus('');
  }
}

async function pickPlain(){
  let title = null;
  while (pool.length){
    const t = pool.shift();
    if (!seenSet.has(t)){ title = t; break; }
  }
  if (!title){
    await refillPool(40);
    if (!pool.length) return null;
    title = pool.shift();
  }
  return await getSummary(title);
}

async function pickPersonal(){
  const n = Math.min(pool.length, 6);
  let best = null, bestIdx = -1, bestScore = -1e9;
  for (let i=0;i<n;i++){
    const s = await getSummary(pool[i]);
    const sc = scoreByProfile(s);
    if (sc > bestScore){ bestScore = sc; best = s; bestIdx = i; }
  }
  if (best && bestIdx >= 0){ pool.splice(bestIdx,1); return best; }
  return await pickPlain();
}

// exactly 50% personalized
function pickMode(){ return Math.random() < 0.5 ? "personal" : "explore"; }

let busy = false;
async function showOne(){
  if (busy) return;
  busy = true;
  try{
    setStatus('読み込み中…');
    if (pool.length < 6) await refillPool(40);
    const s = (pickMode()==="personal") ? await pickPersonal() : await pickPlain();
    if (!s){
      titleBox.textContent = "（候補が見つかりません）";
      blurbBox.textContent = "NEXTで再試行してください。";
      setStatus(''); showMain(); return;
    }
    current = s;
    seenSet.add(s.title); saveSeen();
    titleBox.textContent = `【 ${s.title} 】`;
    blurbBox.textContent = s.blurb;
    setStatus(''); showMain();
  } catch(e){
    titleBox.textContent = "（取得エラー）";
    blurbBox.textContent = "NEXTで再試行してください。";
    setStatus(''); showMain();
  } finally { busy = false; }
}

function showMain(){ maintext.hidden = false; altview.hidden = true; backBtn.hidden = true; }
function showAlt(html){ altview.innerHTML = html; maintext.hidden = true; altview.hidden = false; backBtn.hidden = false; }

if (relatedBtn) relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  await learnFrom(current);
  showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
  try {
    const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title), {timeout: 4000}));
    const r = (d.pages || []).map(p => normalizeSummary(p));
    if (!r.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
    const items = r.slice(0,8).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("");
    showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
  } catch(e){
    showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
  }
});
if (openBtn) openBtn.addEventListener('click', async () => {
  if (!current) return;
  await learnFrom(current);
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});

if (nextBtn) nextBtn.addEventListener('click', () => { showOne(); });
if (backBtn) backBtn.addEventListener('click', () => { showMain(); });
if (clearBtn) clearBtn.addEventListener('click', () => { if (!altview.hidden) showMain(); });


// ---- event listeners (clean, single-bind) ----
bindOnce(relatedBtn, 'click', async () => {
  if (!current) return;
  await learnFrom(current);
  showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
  try {
    // Try REST related first
    const cacheKey = "rel:" + current.title;
    if (!window._relCache) window._relCache = new Map();
    if (window._relCache.has(cacheKey)) {
      const items = window._relCache.get(cacheKey);
      const html = items.length
        ? `<h3>RELATED</h3><ul>${items.map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("")}</ul>`
        : "<h3>RELATED</h3><ul><li>(no items)</li></ul>";
      showAlt(html);
      return;
    }
    let r = [];
    try {
      const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title), {timeout: 4500}));
      r = (d.pages || []).map(p => normalizeSummary(p));
    } catch(e){ /* ignore */ }
    // Fallback to search if needed
    if (!r.length) {
      try {
        const q = encodeURIComponent(current.title + " -曖昧さ回避");
        const s = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search="+q+"&limit=10&namespace=0&origin=*", {timeout: 4000}));
        const titles = Array.isArray(s) && s[1] ? s[1] : [];
        r = titles.slice(0,9).map(t => ({ title: t, blurb: "", detail: "", url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(t), description: "" }));
      } catch(e){ /* ignore */ }
    }
    const items = r.slice(0,9);
    if (!window._relCache) window._relCache = new Map();
    window._relCache.set(cacheKey, items);
    const html = items.length
      ? `<h3>RELATED</h3><ul>${items.map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("")}</ul>`
      : `<h3>RELATED</h3><ul><li><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></li></ul>`;
    showAlt(html);
  } catch(e){
    const html = `<h3>RELATED</h3><ul><li><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></li></ul>`;
    showAlt(html);
  }
});

bindOnce(openBtn, 'click', async () => {
  if (!current) return;
  await learnFrom(current);
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});

bindOnce(detailBtn, 'click', async () => {
  if (!current) return;
  await learnFrom(current);
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});

bindOnce(nextBtn, 'click', () => { showOne(); });
bindOnce(backBtn, 'click', () => { showMain(); });
bindOnce(clearBtn, 'click', () => { if (!altview.hidden) showMain(); });
// startup
document.addEventListener('DOMContentLoaded', async () => {
  try { await refillPool(40); await showOne(); }
  catch(e){ titleBox.textContent = "（起動に失敗）"; blurbBox.textContent = "NEXTで再試行してください。"; showMain(); }
});

// SW
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch((e)=>{ /* ignore */ });
}

function escapeHtml(str){
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'};
  return String(str).replace(/[&<>"']/g, s => map[s]);
}
