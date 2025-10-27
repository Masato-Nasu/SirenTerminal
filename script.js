
// v21.6: Learning Mode (up to 50% personalized) + Wikidata/text filters retained
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
const statusEl = document.getElementById('status') || document.querySelector('[data-status]');

// --- small, unobtrusive toggle (if HTML lacks it, we inject one) ---
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
  return true; // default ON if checkbox not found yet
}

let current = null;
const SEEN_KEY = "siren_seen_titles_v21_6";
const SEEN_LIMIT = 100000;
let seenSet = new Set(loadJSON(SEEN_KEY, []));

// --- simple profile store ---
const PROFILE_KEY = "siren_profile_v21_6";
let profile = loadJSON(PROFILE_KEY, { tags:{}, lastLearn:0 });
function saveProfile(){ saveJSON(PROFILE_KEY, profile); }
function bumpTag(t, w=1){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; profile.lastLearn=Date.now(); saveProfile(); }
function topTags(n=25){
  const arr = Object.entries(profile.tags);
  arr.sort((a,b)=>b[1]-a[1]);
  return arr.slice(0,n).map(x=>x[0]);
}
function decayProfile(f=0.98){
  for (const k in profile.tags) profile.tags[k]*=f;
  // cleanup very small
  for (const k of Object.keys(profile.tags)) if (profile.tags[k] < 0.2) delete profile.tags[k];
  saveProfile();
}
setInterval(()=>decayProfile(0.995), 60*1000); // slow decay

// ---- global guards ----
window.addEventListener('unhandledrejection', (e) => {
  console.warn('Unhandled promise rejection:', e.reason);
  failSafe("（起動に失敗）", "通信が不安定です。NEXTを押すか、リロードしてください。");
});
window.addEventListener('error', (e) => {
  console.warn('Error:', e.error || e.message);
});

function setStatus(txt){ if (statusEl) statusEl.textContent = txt; }

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
  let s = sessionStorage.getItem('siren_launch_salt_v21_6');
  if (!s){
    s = String((crypto.getRandomValues(new Uint32Array(2))[0] ^ Date.now()) >>> 0);
    sessionStorage.setItem('siren_launch_salt_v21_6', s);
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

// ---- genre filters (from v21.4 standard) ----
const GENRE_MAP = {
  "all": [],
  "哲学": ["哲学"],
  "科学": ["自然科学","物理学","化学","生物学","天文学","地球科学","科学的方法","統計学"],
  "数学": ["数学"],
  "技術": ["工学","情報技術","電気工学","機械工学","材料工学","計算機科学","ソフトウェア工学"],
  "芸術": ["芸術","美術","音楽","音楽理論","デザイン"],
  "言語学": ["言語学"],
  "心理学": ["心理学","認知科学"],
  "歴史": ["歴史学","世界史","日本史"],
  "文学": ["文学","詩","物語論","文学理論"]
};

const NEG_COMMON = /(企業|会社|市|町|村|鉄道|駅|空港|高校|大学|中学校|小学校|自治体|球団|クラブ|漫画|アニメ|映画|ドラマ|楽曲|アルバム|ゲーム|番組|作品|小説|キャラクター|政治家|俳優|女優|歌手|選手|監督)/;
const POS = {
  "科学": /(学|理論|定理|法則|効果|反応|方程式|現象|仮説|粒子|素粒子|銀河|惑星|恒星|元素|分子|化合物|酵素|細胞|進化|遺伝|電磁|量子|統計|確率|幾何|解析|熱力学|流体|計算|アルゴリズム|データ構造)/,
  "数学": /(数学|定理|補題|命題|写像|群|環|体|加群|トポロジー|測度|微積分|幾何|確率|解析|代数|最適化|数論|組合せ)/,
  "哲学": /(哲学|形而上学|倫理学|認識論|美学|論理|パラドックス|思考実験|概念|命題|規範|価値)/,
  "技術": /(工学|技術|製造|制御|アルゴリズム|プロトコル|アーキテクチャ|通信|暗号|計算|機械|回路|半導体|材料|プログラミング)/,
  "言語学": /(言語学|文法|語彙|意味論|統語論|音韻|音声|形態論|語用論|言語獲得|言語変化)/,
  "心理学": /(心理学|認知|知覚|学習|記憶|注意|動機づけ|感情|発達|人格|臨床|行動|バイアス)/,
  "歴史": /(歴史|時代|王朝|帝国|戦争|条約|革命|制度|年表|史学|文明|文化|遺跡)/,
  "文学": /(文学|詩学|修辞|叙事|叙情|物語論|ジャンル|文芸|文学理論)/,
  "芸術": /(芸術|美術|造形|デザイン|建築|音楽理論|調性|和声|対位法|色彩|構図)/
};
function titlePassesGenre(genre, summary){
  if (!genre || genre === "all") return true;
  const d = (summary.description||"");
  const allowWorks = (genre === "芸術" || genre === "文学");
  if (!allowWorks && NEG_COMMON.test(d)) return false;
  const pos = POS[genre];
  if (!pos) return true;
  return pos.test(d) || d === "";
}

// ---- Wikidata helpers (lightweight) ----
async function getWikidataQid(title){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=pageprops&ppprop=wikibase_item&titles=" + encodeURIComponent(title) + "&origin=*";
  const data = await withBackoff(()=>fetchJSON(url, {timeout: 6000}));
  const pages = data?.query?.pages || {};
  const first = Object.values(pages)[0];
  return first?.pageprops?.wikibase_item || "";
}
async function fetchCategories(title){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&cllimit=30&titles=" + encodeURIComponent(title) + "&origin=*";
  const data = await withBackoff(()=>fetchJSON(url, {timeout: 6000}));
  const pages = data?.query?.pages || {};
  const first = Object.values(pages)[0];
  const cats = first?.categories || [];
  return cats.map(c => String(c.title||'').replace(/^Category:/, ''));
}

// --- learning feature extraction ---
function tokenizeTitleAndBlurb(s){
  const base = (s.title + " " + (s.description||"")).toLowerCase();
  const tokens = base.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.slice(0, 50);
}
async function getSignalsFor(summary){
  const tokens = tokenizeTitleAndBlurb(summary);
  let cats = [];
  try { cats = await fetchCategories(summary.title); } catch(e){}
  return { tokens, cats };
}
function scoreByProfile(summary, signals){
  const tags = topTags(40);
  if (!tags.length) return 0;
  let score = 0;
  for (const t of tags){
    const w = profile.tags[t] || 0;
    if (!w) continue;
    // token match
    for (const tok of signals.tokens){
      if (tok.includes(t) || t.includes(tok)) { score += w * 0.6; break; }
    }
    // category match
    for (const c of signals.cats){
      if (c.includes(t) || t.includes(c)) { score += w * 1.0; break; }
    }
  }
  // small bonus if genre also matches strongly
  if (titlePassesGenre(currentGenre(), summary)) score += 0.5;
  return score;
}

// --- learning triggers: user clicks open/detail/related as "interest" ---
function learnFrom(summary, signals){
  // count categories heavier than tokens
  for (const c of (signals.cats||[])) bumpTag(c, 1.2);
  for (const tok of (signals.tokens||[])) if (tok.length >= 3) bumpTag(tok, 0.3);
}

// ---- genre utilities ----
function currentGenre(){
  if (!genreSel) return "all";
  const g = genreSel.value || "all";
  return GENRE_MAP[g] ? g : "all";
}

// ---- pool & selection ----
let pool = [];
let fetching = false;

async function refillPool(minNeeded = 160){
  if (fetching) return;
  fetching = true;
  try{
    const g = currentGenre();
    const seed = await timeSeed();
    setStatus('起動中…（候補を収集中）');

    let titles = [];
    if (g === "all"){
      titles = await getRandomTitles(230);
    } else {
      titles = await getTitlesByGenre(g, seed);
      if (titles.length < 30){
        try{
          const q = encodeURIComponent(g + " 概念|理論|法則|現象|定理");
          const d = await withBackoff(()=>fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch="+q+"&srlimit=50&srnamespace=0&origin=*", {timeout: 6000}));
          const hits = (d.query && d.query.search) ? d.query.search : [];
          titles = titles.concat(hits.map(h=>h.title));
        }catch(e){}
      }
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
  } catch(e){
    console.warn('refillPool failed:', e);
  } finally {
    fetching = false;
    setStatus('');
  }
}

async function getTitlesByGenre(genre, seed){
  const cats = GENRE_MAP[genre] || [];
  let titles = [];
  for (const c of cats){
    let cont = ""; let collected = [];
    for (let i=0;i<2;i++){
      const r = await fetchCategoryBatch(c, cont);
      collected = collected.concat(r.titles);
      cont = r.cont;
      if (!cont) break;
    }
    titles = titles.concat(collected);
  }
  titles = Array.from(new Set(titles));
  shuffleWithSeed(titles, seed);
  return titles;
}
async function fetchCategoryBatch(catTitle, cmcontinue=""){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle="
    + encodeURIComponent("Category:"+catTitle)
    + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*"
    + (cmcontinue ? "&cmcontinue="+encodeURIComponent(cmcontinue) : "");
  const data = await withBackoff(()=>fetchJSON(url, {timeout: 6000}));
  const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
  const cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
  return { titles: members.map(m=>m.title), cont };
}
async function getRandomTitles(limit=220){
  const data = await withBackoff(()=>fetchJSON(
    "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit="+limit+"&origin=*",
    {timeout: 6000}
  ));
  const arr = (data.query && data.query.random) ? data.query.random : [];
  return arr.map(x => x.title);
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
      return { title, blurb:"（概要取得に失敗）", detail:"（詳細取得に失敗）", url: "https://ja.wikipedia.org/wiki/" + encodeURIComponent(title), description: "" };
    }
  }
}

// Decide whether to serve personalized (<=50%) or exploratory
function pickMode(){
  if (!isLearningEnabled()) return "explore";
  return Math.random() < 0.5 ? "personal" : "explore";
}

async function pickNew(){
  if (pool.length < 12) await refillPool(180);

  // exploratory pick helper
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
    const s = await fetchSummaryByTitle(title);
    const g = currentGenre();
    // weak genre filter (to keep variety but avoid egregious mismatches)
    if (g !== "all" && !titlePassesGenre(g, s)){
      return await pickPlain(); // try next
    }
    return s;
  }

  // personalized pick helper: sample a handful, score by profile, take best
  async function pickPersonal(){
    const candidates = [];
    const sampled = [];
    // take up to 14 samples from the head of pool (without losing them permanently)
    const takeN = Math.min(pool.length, 14);
    for (let i=0;i<takeN;i++){
      const t = pool.shift();
      sampled.push(t);
    }
    // restore sampled back after scoring (preserve order)
    for (const t of sampled) pool.push(t);

    for (const t of sampled.slice(0,14)){
      const s = await fetchSummaryByTitle(t);
      const sig = await getSignalsFor(s);
      const sc = scoreByProfile(s, sig);
      candidates.push({t, s, sig, sc});
    }
    candidates.sort((a,b)=>b.sc-a.sc);
    // pick highest that also passes weak genre check
    for (const c of candidates){
      if (currentGenre() !== "all" && !titlePassesGenre(currentGenre(), c.s)) continue;
      // remove chosen from pool
      const idx = pool.indexOf(c.t);
      if (idx >= 0) pool.splice(idx,1);
      return c.s;
    }
    // fallback
    return await pickPlain();
  }

  const mode = pickMode();
  return mode === "personal" ? await pickPersonal() : await pickPlain();
}

let busy = false;
async function showOne(){
  if (busy) return;
  busy = true;
  try{
    setStatus('読み込み中…');
    const s = await pickNew();
    if (!s){
      titleBox.textContent = "（候補が見つかりません）";
      blurbBox.textContent = "NEXTで再試行してください。";
      setStatus('');
      showMain();
      return;
    }
    current = s;
    seenSet.add(s.title); saveSeen();
    titleBox.textContent = `【 ${s.title} 】`;
    blurbBox.textContent = s.blurb;
    setStatus('');
    showMain();
  } catch(e){
    console.warn('showOne failed:', e);
    titleBox.textContent = "（取得エラー）";
    blurbBox.textContent = "通信が混み合っています。少し待ってNEXTをお試しください。";
    setStatus('');
    showMain();
  } finally {
    busy = false;
  }
}

// ---- events ----
if (detailBtn) detailBtn.addEventListener('click', async () => {
  if (!current) return;
  const sig = await getSignalsFor(current);
  learnFrom(current, sig);
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});
if (relatedBtn) relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  const sig = await getSignalsFor(current);
  learnFrom(current, sig);
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
  const sig = await getSignalsFor(current);
  learnFrom(current, sig);
  const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null);
  if (url) window.open(url, '_blank', 'noopener');
});
if (nextBtn) nextBtn.addEventListener('click', () => { showOne(); });
if (backBtn) backBtn.addEventListener('click', () => { showMain(); });
if (clearBtn) clearBtn.addEventListener('click', () => { if (!altview.hidden) showMain(); });

// ---- startup ----
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await refillPool(200);
    await showOne();
  } catch(e){
    console.warn('startup failed:', e);
    titleBox.textContent = "（起動に失敗）";
    blurbBox.textContent = "NEXTを押して再試行してください。";
    showMain();
  }
});

// SW登録
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch((e)=>{
    console.warn('SW register failed', e);
  });
}

function escapeHtml(str){
  const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'};
  return String(str).replace(/[&<>"']/g, s => map[s]);
}
