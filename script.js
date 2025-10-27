
// v21.7: No-genre mode, robust offline fallback, Learning up to 50%
const titleBox = document.getElementById('title');
const blurbBox = document.getElementById('blurb');
const genreSel = document.getElementById('genreSel'); // may exist in old HTML; we will hide it
const detailBtn = document.getElementById('detailBtn');
const relatedBtn = document.getElementById('relatedBtn');
const openBtn = document.getElementById('openBtn');
const nextBtn = document.getElementById('nextBtn');
const backBtn = document.getElementById('backBtn');
const clearBtn = document.getElementById('clearBtn');
const maintext = document.getElementById('maintext');
const altview = document.getElementById('altview');
const statusEl = document.getElementById('status') || document.querySelector('[data-status]');

// Hide genre UI if present (keep HTML unchanged)
if (genreSel) { genreSel.style.display = 'none'; }

let current = null;
const SEEN_KEY = "siren_seen_titles_v21_7";
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));

// --- learning toggle (keep simple)
let learnToggle = document.getElementById('learnToggle');
if (!learnToggle) {
  learnToggle = document.createElement('label');
  learnToggle.id = 'learnToggle';
  learnToggle.style.cssText = 'position:fixed;right:10px;bottom:10px;background:#0008;color:#fff;padding:6px 10px;border-radius:12px;font-size:12px;cursor:pointer;z-index:9999;user-select:none;';
  learnToggle.innerHTML = '<input type="checkbox" id="learnChk" style="vertical-align:middle;margin-right:6px"/><span>学習モード（最大50%）</span>';
  document.addEventListener('DOMContentLoaded', ()=>document.body.appendChild(learnToggle));
}
function isLearningEnabled(){
  const el = document.getElementById('learnChk');
  if (el) return el.checked;
  return true;
}

const PROFILE_KEY = "siren_profile_v21_7";
let profile = loadJSON(PROFILE_KEY, { tags:{}, lastLearn:0 });
function saveProfile(){ saveJSON(PROFILE_KEY, profile); }
function bumpTag(t, w=1){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; profile.lastLearn=Date.now(); saveProfile(); }
function topTags(n=25){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }
function decayProfile(f=0.98){ for (const k in profile.tags) profile.tags[k]*=f; for (const k of Object.keys(profile.tags)) if (profile.tags[k] < 0.2) delete profile.tags[k]; saveProfile(); }
setInterval(()=>decayProfile(0.995), 60*1000);

function setStatus(txt){ if (statusEl) statusEl.textContent = txt; }

// helpers
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
  let s = sessionStorage.getItem('siren_launch_salt_v21_7');
  if (!s){
    s = String((crypto.getRandomValues(new Uint32Array(2))[0] ^ Date.now()) >>> 0);
    sessionStorage.setItem('siren_launch_salt_v21_7', s);
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
async function fetchJSON(url, {timeout=6500} = {}){
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
function normalizeSummary(data){
  const title = data.title || "（無題）";
  const blurb = data.description ? `${data.description}` : (data.extract ? (data.extract.split("。")[0] + "。") : "（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url, description: (data.description||"") };
}
async function withBackoff(fn, tries=5){
  let lastErr;
  for (let i=0;i<tries;i++){
    try { return await fn(); }
    catch(e){ lastErr=e; await new Promise(r=>setTimeout(r, Math.min(1600, 200*Math.pow(2,i)))); }
  }
  throw lastErr;
}

// offline seed (curated concepts; used when network is flaky)
const LOCAL_SEED = ["熱力学第二法則", "量子もつれ", "シュレーディンガー方程式", "相対性理論", "オームの法則", "ファラデーの電磁誘導の法則", "DNA複製", "自然選択", "プレートテクトニクス", "ビッグバン理論", "銀河形成", "ブラックホール", "エントロピー", "ベイズ推定", "中心極限定理", "マルコフ過程", "フーリエ変換", "ラプラス変換", "偏微分方程式", "線形代数", "行列分解", "固有値", "ニューラルネットワーク", "サポートベクターマシン", "アルゴリズム", "データ構造", "計算量理論", "NP完全", "公開鍵暗号", "RSA暗号", "ハッシュ関数", "誤り訂正符号", "圧縮", "情報理論", "ゲーム理論", "囚人のジレンマ", "進化ゲーム", "認知バイアス", "プロスペクト理論", "強化学習", "Q学習", "グラフ理論", "ダイクストラ法", "最小全域木", "トポロジー", "位相空間", "群論", "環論", "体論", "ガロア理論", "相転移", "臨界現象", "イジング模型", "流体力学", "ナビエ–ストークス方程式", "乱流", "カオス理論", "フラクタル", "気候変動", "温室効果", "エルニーニョ", "太陽活動", "宇宙背景放射", "核融合", "太陽電池", "半導体", "トランジスタ", "材料科学", "超伝導", "フォノン", "フォトニクス", "レーザー", "光ファイバ", "量子コンピュータ", "量子誤り訂正", "ブロックチェーン", "分散システム", "コンセンサスアルゴリズム", "Raft", "Paxos", "CAP定理", "ネットワーク層", "TCP/IP", "HTTP", "データベース", "正規化", "トランザクション", "ACID特性", "可観測性", "モニタリング", "A/Bテスト", "因果推論", "操作変数法", "回帰不連続", "差分の差分", "メタ分析", "サンプルサイズ設計", "実験計画法", "応答曲面法"];

async function getRandomTitles(limit=220){
  try {
    const data = await withBackoff(()=>fetchJSON(
      "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit="+limit+"&origin=*",
      {timeout: 6000}
    ));
    const arr = (data.query && data.query.random) ? data.query.random : [];
    if (arr.length) return arr.map(x => x.title);
  } catch(e) {}
  // fallback to local seed (shuffled)
  const seed = await timeSeed();
  return shuffleWithSeed(LOCAL_SEED.slice(), seed);
}

async function fetchSummaryByTitle(title){
  try {
    const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title), {timeout: 6000}));
    return normalizeSummary(d);
  } catch(e1){
    try{
      const d2 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search=" + encodeURIComponent(title) + "&limit=1&namespace=0&origin=*", {timeout: 6000}));
      const t = Array.isArray(d2) && d2[1] && d2[1][0] ? d2[1][0] : title;
      const d3 = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t), {timeout: 6000}));
      return normalizeSummary(d3);
    }catch(e2){
      // final fallback: minimal object with wiki url
      return { title, blurb:"（概要取得に失敗）", detail:"（詳細取得に失敗）", url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(title), description: "" };
    }
  }
}

// learning signals
function tokenizeTitleAndBlurb(s){
  const base = (s.title + " " + (s.description||"")).toLowerCase();
  const tokens = base.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.slice(0, 50);
}
async function fetchCategories(title){
  try {
    const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&cllimit=30&titles=" + encodeURIComponent(title) + "&origin=*";
    const data = await withBackoff(()=>fetchJSON(url, {timeout: 6000}));
    const pages = data?.query?.pages || {};
    const first = Object.values(pages)[0];
    const cats = first?.categories || [];
    return cats.map(c => String(c.title||'').replace(/^Category:/, ''));
  } catch(e){ return []; }
}
async function getSignalsFor(summary){
  const tokens = tokenizeTitleAndBlurb(summary);
  const cats = await fetchCategories(summary.title);
  return { tokens, cats };
}
function scoreByProfile(summary, signals){
  const tags = topTags(40);
  if (!tags.length) return 0;
  let score = 0;
  for (const t of tags){
    const w = profile.tags[t] || 0;
    if (!w) continue;
    for (const tok of signals.tokens){
      if (tok.includes(t) || t.includes(tok)) { score += w * 0.6; break; }
    }
    for (const c of signals.cats){
      if (c.includes(t) || t.includes(c)) { score += w * 1.0; break; }
    }
  }
  return score;
}
function learnFrom(summary, signals){
  for (const c of (signals.cats||[])) bumpTag(c, 1.2);
  for (const tok of (signals.tokens||[])) if (tok.length >= 3) bumpTag(tok, 0.3);
}

// pool & selection
let pool = [];
let fetching = false;

async function refillPool(minNeeded = 160){
  if (fetching) return;
  fetching = true;
  try{
    const seed = await timeSeed();
    setStatus('起動中…（候補を収集中）');

    let titles = await getRandomTitles(230);

    titles = shuffleWithSeed(
      titles.filter(t => !seenSet.has(t)),
      seed ^ BigInt(pool.length)
    );

    const exist = new Set(pool);
    for (const t of titles){
      if (!exist.has(t)) pool.push(t);
      if (pool.length >= minNeeded) break;
    }
  } catch(e){
    console.warn('refillPool failed:', e);
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
    await refillPool(200);
    if (!pool.length) return null;
    title = pool.shift();
  }
  return await fetchSummaryByTitle(title);
}

async function pickPersonal(){
  const candidates = [];
  const sampled = [];
  const takeN = Math.min(pool.length, 14);
  for (let i=0;i<takeN;i++){ const t = pool.shift(); sampled.push(t); }
  for (const t of sampled) pool.push(t);
  for (const t of sampled.slice(0,14)){
    const s = await fetchSummaryByTitle(t);
    const sig = await getSignalsFor(s);
    const sc = scoreByProfile(s, sig);
    candidates.push({t, s, sig, sc});
  }
  candidates.sort((a,b)=>b.sc-a.sc);
  for (const c of candidates){
    const idx = pool.indexOf(c.t);
    if (idx >= 0) pool.splice(idx,1);
    return c.s;
  }
  return await pickPlain();
}

function pickMode(){
  if (!isLearningEnabled()) return "explore";
  return Math.random() < 0.5 ? "personal" : "explore";
}

let busy = false;
async function showOne(){
  if (busy) return;
  busy = true;
  try{
    setStatus('読み込み中…');
    if (pool.length < 12) await refillPool(180);
    const mode = pickMode();
    const s = mode === "personal" ? await pickPersonal() : await pickPlain();
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
    console.warn('showOne failed:', e);
    titleBox.textContent = "（取得エラー）";
    blurbBox.textContent = "オフライン種から再試行できます。NEXTを押してください。";
    setStatus(''); showMain();
  } finally { busy = false; }
}

function showMain(){ maintext.hidden = false; altview.hidden = true; backBtn.hidden = true; }
function showAlt(html){ altview.innerHTML = html; maintext.hidden = true; altview.hidden = false; backBtn.hidden = false; }

if (detailBtn) detailBtn.addEventListener('click', async () => {
  if (!current) return;
  const sig = await getSignalsFor(current); learnFrom(current, sig);
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});
if (relatedBtn) relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  const sig = await getSignalsFor(current); learnFrom(current, sig);
  showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
  try {
    const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title), {timeout: 6000}));
    const r = (d.pages || []).map(p => normalizeSummary(p));
    if (!r.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
    const items = r.slice(0,9).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("");
    showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
  } catch(e){
    showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
  }
});
if (openBtn) openBtn.addEventListener('click', async () => {
  if (!current) return;
  const sig = await getSignalsFor(current); learnFrom(current, sig);
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});
if (nextBtn) nextBtn.addEventListener('click', () => { showOne(); });
if (backBtn) backBtn.addEventListener('click', () => { showMain(); });
if (clearBtn) clearBtn.addEventListener('click', () => { if (!altview.hidden) showMain(); });

// startup
document.addEventListener('DOMContentLoaded', async () => {
  try { await refillPool(200); await showOne(); }
  catch(e){ console.warn('startup failed:', e); titleBox.textContent = "（起動に失敗）"; blurbBox.textContent = "NEXTを押して再試行してください。"; showMain(); }
});

// SW
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch((e)=>{ console.warn('SW register failed', e); });
}

function escapeHtml(str){
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'};
  return String(str).replace(/[&<>"']/g, s => map[s]);
}
