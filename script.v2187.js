
'use strict';
// v21.8.6: Syntax fix, JANRE/GENRE UI purge, robust handlers

// --- Elements (may be missing; will resolve later) ---
let titleBox = document.getElementById('title');
let blurbBox = document.getElementById('blurb');
let relatedBtn = document.getElementById('relatedBtn');
let openBtn = document.getElementById('openBtn');
let detailBtn = document.getElementById('detailBtn');
let nextBtn = document.getElementById('nextBtn');
let backBtn = document.getElementById('backBtn');
let clearBtn = document.getElementById('clearBtn');
let maintext = document.getElementById('maintext');
let altview = document.getElementById('altview');
let statusEl = document.getElementById('status') || document.querySelector('[data-status]');

// --- Purge any JANRE/GENRE/ジャンル UI ---
(function purgeGenre(){
  const selectors = [
    "[id*='genre' i]","[class*='genre' i]","input[name*='genre' i]",
    "[id*='janre' i]","[class*='janre' i]","input[name*='janre' i]"
  ];
  for (const sel of selectors){
    for (const el of Array.from(document.querySelectorAll(sel))){
      el.remove();
    }
  }
  const blocks = Array.from(document.querySelectorAll('fieldset,section,div,form,ul,ol,label'));
  for (const n of blocks){
    const t = (n.textContent||'') + ' ' + (n.id||'') + ' ' + (n.className||'') + ' ' + (n.getAttribute('name')||'') + ' ' + (n.getAttribute('aria-label')||'');
    if (/(ジャンル|genre|janre)/i.test(t)) n.style.display='none';
  }
})();

function setStatus(txt){ if (statusEl) statusEl.textContent = txt; }

// --- Utilities ---
function loadJSON(key, fallback){ try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function saveJSON(key, value){ try { localStorage.setItem(key, JSON.stringify(value)); } catch{} }
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return((t^t>>>14)>>>0)/4294967296; }; }
function shuffleWithSeed(arr, seed){
  const rand = mulberry32(Number(seed & 0xffffffffn) || 1);
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sessionSalt(){
  let s = sessionStorage.getItem('siren_launch_salt_v21_8_6');
  if (!s){ s = String((crypto.getRandomValues(new Uint32Array(2))[0] ^ Date.now()) >>> 0); sessionStorage.setItem('siren_launch_salt_v21_8_6', s); }
  return BigInt.asUintN(64, BigInt(parseInt(s,10) >>> 0));
}
let pickCounter = 0n;
function saltedRandSeed(){ return sessionSalt() ^ BigInt(Date.now() >>> 0) ^ (pickCounter++); }
function bust(u){ const sep = u.includes('?') ? '&' : '?'; return `${u}${sep}t=${Date.now()}`; }
async function fetchJSON(url, {timeout=4200} = {}){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeout);
  try{
    const res = await fetch(bust(url), { mode:'cors', headers:{'Accept':'application/json'}, cache:'no-store', signal:ctrl.signal });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const ct = res.headers.get('content-type')||'';
    if (!ct.includes('application/json')) throw new Error('Non-JSON');
    return await res.json();
  } finally { clearTimeout(t); }
}
async function withBackoff(fn, tries=3){
  let last;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch(e){ last=e; await new Promise(r=>setTimeout(r, 200*(i+1))); }
  }
  throw last;
}
function escapeHtml(str){
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'};
  return String(str).replace(/[&<>\"']/g, s => map[s]);
}

// --- Offline seed (carry from previous build) ---
const LOCAL_SEED = [];

// --- State ---
let current = null;
const SEEN_KEY = 'siren_seen_titles_v21_8_6';
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));
function saveSeen(){
  if (seenSet.size > SEEN_LIMIT){
    const keep = Array.from(seenSet).slice(-Math.floor(SEEN_LIMIT*0.8));
    seenSet = new Set(keep);
  }
  saveJSON(SEEN_KEY, Array.from(seenSet));
}

// Learning profile
const PROFILE_KEY = 'siren_profile_v21_8_6';
let profile = loadJSON(PROFILE_KEY, { tags:{}, lastLearn:0 });
function saveProfile(){ saveJSON(PROFILE_KEY, profile); }
function bumpTag(t,w=1){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; profile.lastLearn=Date.now(); saveProfile(); }
function topTags(n=20){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }
function decayProfile(f=0.9997){ for (const k in profile.tags) profile.tags[k]*=f; for (const k of Object.keys(profile.tags)) if (profile.tags[k]<0.12) delete profile.tags[k]; saveProfile(); }
setInterval(()=>decayProfile(0.9997), 60*1000);

// Memo
const memo = new Map();
function tokenize(summary){
  const base = (summary.title + ' ' + (summary.description||'')).toLowerCase();
  return base.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 30);
}
function scoreByProfile(summary){
  const tags = topTags(20);
  if (!tags.length) return 0;
  const toks = tokenize(summary);
  let score = 0;
  for (const t of tags){
    const w = profile.tags[t] || 0;
    if (!w) continue;
    for (const tok of toks){ if (tok.includes(t) || t.includes(tok)) { score += w; break; } }
  }
  return score;
}

// Summaries
function normalizeSummary(data){
  const title = data.title || '（無題）';
  const blurb = data.description ? `${data.description}` : (data.extract ? (data.extract.split('。')[0] + '。') : '（概要なし）');
  const detail = data.extract || '（詳細なし）';
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ('https://ja.wikipedia.org/wiki/' + encodeURIComponent(title));
  return { title, blurb, detail, url, description:(data.description||'') };
}
async function getSummary(title){
  if (memo.has(title)) return memo.get(title);
  try{
    const d = await withBackoff(()=>fetchJSON('https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title), {timeout:3800}));
    const s = normalizeSummary(d); memo.set(title,s); return s;
  }catch(e1){
    try{
      const d2 = await withBackoff(()=>fetchJSON('https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=' + encodeURIComponent(title) + '&limit=1&namespace=0&origin=*', {timeout:3400}));
      const t = Array.isArray(d2) && d2[1] && d2[1][0] ? d2[1][0] : title;
      const d3 = await withBackoff(()=>fetchJSON('https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(t), {timeout:3400}));
      const s = normalizeSummary(d3); memo.set(title,s); return s;
    }catch(e2){
      const s = { title, blurb:'（概要取得に失敗）', detail:'（詳細取得に失敗）', url:'https://ja.wikipedia.org/wiki/' + encodeURIComponent(title), description:'' };
      memo.set(title,s); return s;
    }
  }
}

// Random titles
async function fetchRandomBatch(n=40){
  try{
    const data = await withBackoff(()=>fetchJSON('https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit='+n+'&origin=*', {timeout:3800}));
    const arr = (data.query && data.query.random) ? data.query.random : [];
    if (arr.length) return arr.map(x=>x.title);
  }catch(e){}
  const seed = saltedRandSeed();
  return shuffleWithSeed(LOCAL_SEED.slice(), seed).slice(0, n);
}

// Learning
async function learnFrom(summary){
  try{
    const url = 'https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&cllimit=20&titles=' + encodeURIComponent(summary.title) + '&origin=*';
    const data = await withBackoff(()=>fetchJSON(url, {timeout:3400}));
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const cats = (first?.categories || []).map(c => String(c.title||'').replace(/^Category:/,''));
    for (const c of cats) bumpTag(c, 1.6);
  }catch(e){}
  for (const tok of tokenize(summary)) if (tok.length >= 3) bumpTag(tok, 0.35);
}

// Pool & selection
let pool = []; // fixed declaration
let fetching = false;
async function refillPool(minNeeded=40){
  if (fetching) return;
  fetching = true;
  try{
    setStatus('候補を収集中…');
    const titles = await fetchRandomBatch(50);
    const seed = saltedRandSeed();
    const add = shuffleWithSeed(titles.filter(t => !seenSet.has(t)), seed);
    const exist = new Set(pool);
    for (const t of add){
      if (!exist.has(t)) pool.push(t);
      if (pool.length >= minNeeded) break;
    }
  } finally { fetching = false; setStatus(''); }
}

async function pickPlain(){
  let title = null;
  while (pool.length){ const t = pool.shift(); if (!seenSet.has(t)){ title = t; break; } }
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
  if (bestIdx >= 0){ pool.splice(bestIdx,1); return best; }
  return await pickPlain();
}
function pickMode(){ return Math.random() < 0.5 ? 'personal' : 'explore'; }

let busy = false;
async function showOne(){
  if (busy) return;
  busy = true;
  try{
    setStatus('読み込み中…');
    if (pool.length < 6) await refillPool(40);
    const s = (pickMode()==='personal') ? await pickPersonal() : await pickPlain();
    if (!s){
      if (titleBox) titleBox.textContent = '（候補が見つかりません）';
      if (blurbBox) blurbBox.textContent = 'NEXTで再試行してください。';
      setStatus(''); showMain(); return;
    }
    current = s;
    seenSet.add(s.title); saveSeen();
    if (titleBox) titleBox.textContent = `【 ${s.title} 】`;
    if (blurbBox) blurbBox.textContent = s.blurb;
    setStatus(''); showMain();
  }catch(e){
    if (titleBox) titleBox.textContent = '（取得エラー）';
    if (blurbBox) blurbBox.textContent = 'NEXTで再試行してください。';
    setStatus(''); showMain();
  }finally{ busy = false; }
}

function showMain(){ if (maintext) maintext.hidden = false; if (altview) altview.hidden = true; if (backBtn) backBtn.hidden = true; }
function showAlt(html){ if (altview) altview.innerHTML = html; if (maintext) maintext.hidden = true; if (altview) altview.hidden = false; if (backBtn) backBtn.hidden = false; }

// Button resolver + single-bind
function resolveButton(primaryId, altIds, textHints){
  const byId = id => (id ? document.getElementById(id) : null);
  for (const id of [primaryId].concat(altIds||[])){ const el = byId(id); if (el) return el; }
  for (const hint of (textHints||[])){
    const el = document.querySelector(`[data-action*="${hint}"]`);
    if (el) return el;
  }
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  function hasText(n){
    const t = (n.textContent||'').trim();
    return (textHints||[]).some(h => new RegExp(h, 'i').test(t));
  }
  for (const n of nodes){ if (hasText(n)) return n; }
  return null;
}
function bindOnce(el, type, handler){
  if (!el) return;
  const key = '__bound_' + type;
  if (el[key]) return;
  el.addEventListener(type, handler);
  el[key] = true;
}

document.addEventListener('DOMContentLoaded', () => {
  titleBox = titleBox || document.getElementById('title');
  blurbBox = blurbBox || document.getElementById('blurb');
  maintext = maintext || document.getElementById('maintext');
  altview = altview || document.getElementById('altview');
  statusEl = statusEl || document.getElementById('status') || document.querySelector('[data-status]');

  detailBtn = resolveButton('detailBtn', ['moreBtn','btnDetail','btnMore','detail','more'], ['MORE','詳細','DETAIL']) || detailBtn;
  relatedBtn = resolveButton('relatedBtn', ['btnRelated','relBtn','related'], ['RELATED','関連']) || relatedBtn;
  openBtn = resolveButton('openBtn', ['wikiBtn','btnOpen','open','wiki'], ['WIKI','OPEN','開く']) || openBtn;
  nextBtn = resolveButton('nextBtn', ['btnNext','next'], ['NEXT','次']) || nextBtn;
  backBtn = resolveButton('backBtn', ['btnBack','back'], ['BACK','戻る']) || backBtn;
  clearBtn = resolveButton('clearBtn', ['btnClear','clear'], ['CLEAR','閉じる']) || clearBtn;

  bindOnce(relatedBtn, 'click', async () => {
    if (!current) return;
    await learnFrom(current);
    showAlt('<h3>RELATED</h3><ul><li>loading…</li></ul>');
    try{
      window._relCache = window._relCache || new Map();
      const cacheKey = 'rel:'+current.title;
      if (window._relCache.has(cacheKey)){
        const items = window._relCache.get(cacheKey);
        const html = items.length
          ? `<h3>RELATED</h3><ul>${items.map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join('')}</ul>`
          : '<h3>RELATED</h3><ul><li>(no items)</li></ul>';
        showAlt(html); return;
      }
      let r = [];
      try{ const d = await withBackoff(()=>fetchJSON('https://ja.wikipedia.org/api/rest_v1/page/related/' + encodeURIComponent(current.title), {timeout:4200})); r = (d.pages||[]).map(p=>normalizeSummary(p)); }catch(e){}
      if (!r.length){
        try{ const q = encodeURIComponent(current.title + ' -曖昧さ回避'); const s = await withBackoff(()=>fetchJSON('https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search='+q+'&limit=10&namespace=0&origin=*', {timeout:3800})); const titles = Array.isArray(s)&&s[1]?s[1]:[]; r = titles.slice(0,9).map(t=>({ title:t, blurb:'', detail:'', url:'https://ja.wikipedia.org/wiki/' + encodeURIComponent(t), description:'' })); }catch(e){}
      }
      const items = r.slice(0,9);
      window._relCache.set(cacheKey, items);
      const html = items.length
        ? `<h3>RELATED</h3><ul>${items.map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join('')}</ul>`
        : `<h3>RELATED</h3><ul><li><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></li></ul>`;
      showAlt(html);
    }catch(e){
      const html = `<h3>RELATED</h3><ul><li><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></li></ul>`;
      showAlt(html);
    }
  });

  bindOnce(openBtn, 'click', async () => {
    if (!current) return;
    await learnFrom(current);
    const url = current?.url || (current?.title ? 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(current.title) : null);
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
});

// Startup
document.addEventListener('DOMContentLoaded', async () => { try { await refillPool(40); await showOne(); } catch(e){ if (titleBox) titleBox.textContent='（起動に失敗）'; if (blurbBox) blurbBox.textContent='NEXTで再試行してください。'; showMain(); } });

// SW
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) { navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch(()=>{}); }
