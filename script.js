
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

function bindOnce(el, type, handler){
  if (!el) return;
  const key = "__bound_" + type;
  if (el[key]) return;
  el.addEventListener(type, handler);
  el[key] = true;
}


// ---- helpers ----
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
  let s = sessionStorage.getItem('siren_launch_salt_v21_8_1');
  if (!s){
    s = String((crypto.getRandomValues(new Uint32Array(2))[0] ^ Date.now()) >>> 0);
    sessionStorage.setItem('siren_launch_salt_v21_8_1', s);
  }
  return BigInt.asUintN(64, BigInt(parseInt(s,10) >>> 0));
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
async function fetchJSON(url, {timeout=4200} = {}){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeout);
  try {
    const res = await fetch(bust(url), { mode: "cors", headers: { "Accept": "application/json" }, cache: "no-store", signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const ct = res.headers.get('content-type')||'';
    if (!ct.includes('application/json')) throw new Error("Non-JSON");
    return await res.json();
  } finally { clearTimeout(t); }
}
async function withBackoff(fn, tries=3){
  let lastErr;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch(e){ lastErr=e; await new Promise(r=>setTimeout(r, 200*(i+1))); }
  }
  throw lastErr;
}
function normalizeSummary(data){
  const title = data.title || "（無題）";
  const blurb = data.description ? `${data.description}` : (data.extract ? (data.extract.split("。")[0] + "。") : "（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url, description: (data.description||"") };
}

// offline seed
const LOCAL_SEED = ["熱力学第二法則", "量子もつれ", "シュレーディンガー方程式", "相対性理論", "オームの法則", "ファラデーの電磁誘導の法則", "DNA複製", "自然選択", "プレートテクトニクス", "ビッグバン理論", "銀河形成", "ブラックホール", "エントロピー", "ベイズ推定", "中心極限定理", "マルコフ過程", "フーリエ変換", "ラプラス変換", "偏微分方程式", "線形代数", "行列分解", "固有値", "ニューラルネットワーク", "サポートベクターマシン", "アルゴリズム", "データ構造", "計算量理論", "NP完全", "公開鍵暗号", "RSA暗号", "ハッシュ関数", "誤り訂正符号", "圧縮", "情報理論", "ゲーム理論", "囚人のジレンマ", "進化ゲーム", "認知バイアス", "プロスペクト理論", "強化学習", "Q学習", "グラフ理論", "ダイクストラ法", "最小全域木", "トポロジー", "位相空間", "群論", "環論", "体論", "ガロア理論", "相転移", "臨界現象", "イジング模型", "流体力学", "ナビエ–ストークス方程式", "乱流", "カオス理論", "フラクタル", "気候変動", "温室効果", "エルニーニョ", "太陽活動", "宇宙背景放射", "核融合", "太陽電池", "半導体", "トランジスタ", "材料科学", "超伝導", "フォノン", "フォトニクス", "レーザー", "光ファイバ", "量子コンピュータ", "量子誤り訂正", "ブロックチェーン", "分散システム", "コンセンサスアルゴリズム", "Raft", "Paxos", "CAP定理", "ネットワーク層", "TCP/IP", "HTTP", "データベース", "正規化", "トランザクション", "ACID特性", "可観測性", "モニタリング", "A/Bテスト", "因果推論", "操作変数法", "回帰不連続", "差分の差分", "メタ分析", "サンプルサイズ設計", "実験計画法", "応答曲面法"];

// Memoized summaries
const memo = new Map();
const memoRelated = new Map();
async function getSummary(title){
  if (memo.has(title)) return memo.get(title);
  try {
    const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title), {timeout: 4000}));
    const s = normalizeSummary(d); memo.set(title, s); return s;
  } catch(e1){
    try{
      const d2 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=1&namespace=0&origin=*", {timeout: 3500}));
      const t = Array.isArray(d2) && d2[1] && d2[1][0] ? d2[1][0] : title;
      const d3 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t), {timeout: 3500}));
      const s = normalizeSummary(d3); memo.set(title, s); return s;
    }catch(e2){
      const s = { title, blurb:"（概要取得に失敗）", detail:"（詳細取得に失敗）", url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(title), description: "" };
      memo.set(title, s); return s;
    }
  }
}

// Tokenization & scoring (light)
function tokenize(summary){
  const base = (summary.title + " " + (summary.description||"")).toLowerCase();
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
    for (const tok of toks){
      if (tok.includes(t) || t.includes(tok)) { score += w; break; }
    }
  }
  return score;
}

// Learn only on RELATED/WIKI (Open)
async function learnFrom(summary){
  try {
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&cllimit=20&titles=" + encodeURIComponent(summary.title) + "&origin=*";
    const data = await withBackoff(()=>fetchJSON(url, {timeout: 3500}));
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const cats = (first?.categories || []).map(c => String(c.title||'').replace(/^Category:/, ''));
    for (const c of cats) bumpTag(c, 1.6);
  } catch(e){ /* ignore */ }
  for (const tok of tokenize(summary)) if (tok.length >= 3) bumpTag(tok, 0.35);
}


// --- Robust button resolution by id, data-action, or visible text ---
function resolveButton(primaryId, altIds, textHints){
  const byId = (id)=> document.getElementById(id);
  for (const id of [primaryId].concat(altIds||[])){
    const el = byId(id);
    if (el) return el;
  }
  // data-action
  for (const hint of textHints||[]){
    const el = document.querySelector(`[data-action*="${hint}"]`);
    if (el) return el;
  }
  // by text content (button or a)
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"]'));
  function hasText(n){
    const t = (n.textContent||"").trim();
    return textHints.some(h => new RegExp(h, 'i').test(t));
  }
  for (const n of nodes){ if (hasText(n)) return n; }
  return null;
}

// Re-resolve buttons after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // DETAIL / MORE
  const detailFallback = resolveButton('detailBtn', ['moreBtn','btnDetail','btnMore'], ['MORE','詳細','DETAIL']);
  if (detailFallback) detailBtn = detailFallback;

  // RELATED
  const relatedFallback = resolveButton('relatedBtn', ['btnRelated','relBtn'], ['RELATED','関連']);
  if (relatedFallback) relatedBtn = relatedFallback;

  // WIKI / OPEN
  const openFallback = resolveButton('openBtn', ['wikiBtn','btnOpen'], ['WIKI','OPEN','開く']);
  if (openFallback) openBtn = openFallback;

  // NEXT
  const nextFallback = resolveButton('nextBtn', ['btnNext'], ['NEXT','次']);
  if (nextFallback) nextBtn = nextFallback;
});

// Pool (tiny) & selection
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
