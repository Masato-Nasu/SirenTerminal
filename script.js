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



// === v19.22: 科学ジャンル限定 + 24連ユニーク + 無限補充（UI非変更） ==============
(function(){
  const tEl = document.getElementById("titleBox") || document.getElementById("title") || document.querySelector(".title");
  const bEl = document.getElementById("blurbBox") || document.getElementById("blurb") || document.querySelector(".blurb") || document.body;

  // --- 設定 ---
  const Q_KEY='siren_v19_22_q';
  const SEEN_KEY='siren_v19_22_seen';
  const CMC_KEY='siren_v19_22_cm'; // カテゴリごとのcmcontinueトークン
  const FIRSTN_KEY='siren_v19_22_firstN_count';
  const FIRSTN_TITLES_KEY='siren_v19_22_firstN_titles';
  const FIRST_N = 24;       // 最初は絶対ユニークで24件出す
  const MAX_QUEUE = 80;     // プール
  const MIN_REFILL = 20;    // 下回ったら補充
  const SEEN_LIMIT = 3000;  // 既読上限（科学カテゴリは広いので多め）

  // 科学系カテゴリ（日本語版）
  const SCI_CATS = [
    "Category:自然科学",
    "Category:物理学",
    "Category:化学",
    "Category:生物学",
    "Category:地球科学",
    "Category:天文学",
    "Category:工学",
    "Category:生命科学",
    "Category:神経科学",
    "Category:科学史"
  ];

  // --- 基本ユーティリティ ---
  const safe=(v,f="") => (typeof v==="string" && v.trim()) ? v : f;
  const jget=(k,d)=>{ try{ return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; }catch{return d;} };
  const jset=(k,v)=> localStorage.setItem(k, JSON.stringify(v));
  const nowTitle=()=> (tEl?.textContent||"").replace(/[【】]/g,"").trim();

  function loadQ(){ return jget(Q_KEY,[]); }
  function saveQ(q){ jset(Q_KEY, q.slice(0, MAX_QUEUE)); }

  function pushSeen(title){
    if (!title) return;
    const set = new Set(jget(SEEN_KEY,[]));
    set.add(title);
    let arr = Array.from(set);
    if (arr.length > SEEN_LIMIT) arr = arr.slice(-Math.floor(SEEN_LIMIT*0.6));
    jset(SEEN_KEY, arr);
  }
  function wasSeen(title){ return jget(SEEN_KEY,[]).includes(title); }

  function firstNCount(){ return jget(FIRSTN_KEY, 0); }
  function setFirstNCount(n){ jset(FIRSTN_KEY, n); }
  function firstNTitles(){ return new Set(jget(FIRSTN_TITLES_KEY, [])); }
  function pushFirstNTitle(title){
    const s = firstNTitles(); s.add(title);
    jset(FIRSTN_TITLES_KEY, Array.from(s));
  }

  function dequeue(){
    const q = loadQ();
    const it = q.shift();
    saveQ(q);
    return it || null;
  }
  function enqueue(items, requireUniqueForFirstN=true){
    const q = loadQ();
    const seenSet = new Set(jget(SEEN_KEY,[]));
    const firstNset = firstNTitles();
    const needUnique = firstNCount() < FIRST_N && requireUniqueForFirstN;
    for (const it of items){
      const title = it?.title; if (!title) continue;
      // まず既読で弾く
      if (seenSet.has(title)) continue;
      // 最初の24件は "これまで出した24件タイトルの重複" も弾く
      if (needUnique && firstNset.has(title)) continue;
      if (q.find(x=>x.title===title)) continue;
      q.push({ title, extract: safe(it.extract,"") });
      if (q.length >= MAX_QUEUE) break;
    }
    saveQ(q);
  }

  // --- MediaWiki Action API（origin=*）---
  async function fetchJSON(u, {retries=3, timeout=8000} = {}){
    for (let a=0; a<=retries; a++){
      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), timeout);
      try{
        const r = await fetch(u + (u.includes('?')?'&':'?') + '_=' + Date.now(), { cache:'no-store', signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP '+r.status);
        const ct = (r.headers.get('content-type')||'').toLowerCase();
        if (!ct.includes('application/json')) throw new Error('CT');
        return await r.json();
      }catch(e){
        clearTimeout(timer);
        await new Promise(rs=>setTimeout(rs, 280*(a+1)));
      }
    }
    return null;
  }
  const enc = (t)=>encodeURIComponent(t).replace(/%20/g,'_');

  async function apiCategoryMembers(catTitle, limit=30){
    // cmcontinue はローテーション管理
    const cmMap = jget(CMC_KEY, {});
    const token = cmMap[catTitle] || "";
    const u = `https://ja.wikipedia.org/w/api.php?action=query&list=categorymembers&cmtitle=${enc(catTitle)}&cmtype=page&cmlimit=${limit}`
              + (token?`&cmcontinue=${encodeURIComponent(token)}`:"")
              + `&format=json&origin=*`;
    const j = await fetchJSON(u);
    if (!j?.query?.categorymembers) return { items:[], next:null };
    const next = j?.continue?.cmcontinue || null;
    cmMap[catTitle] = next || ""; jset(CMC_KEY, cmMap);
    const titles = j.query.categorymembers.map(x=>x.title).filter(Boolean);
    // 要約（extracts）をまとめて取得（最大20ずつ）
    const items = [];
    for (let i=0; i<titles.length; i+=20){
      const batch = titles.slice(i, i+20);
      const titlesParam = batch.map(enc).join('|');
      const u2 = `https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&origin=*&titles=${titlesParam}`;
      const j2 = await fetchJSON(u2);
      const pages = j2?.query?.pages || {};
      for (const k of Object.keys(pages)){
        const p = pages[k];
        if (!p?.title) continue;
        items.push({ title: p.title, extract: safe(p.extract,"") });
      }
    }
    return { items, next };
  }

  async function refillScience(){
    // カテゴリを巡回して順次補充（cmcontinueで深く潜る）
    for (const cat of SCI_CATS){
      const { items } = await apiCategoryMembers(cat, 30);
      if (items && items.length){
        // 最初の24件は重複厳禁フラグを立てる
        enqueue(items, true);
        if (loadQ().length >= MIN_REFILL) break;
      }
    }
    // まだ薄いなら二周目
    if (loadQ().length < MIN_REFILL){
      for (const cat of SCI_CATS){
        const { items } = await apiCategoryMembers(cat, 30);
        if (items && items.length){
          enqueue(items, true);
          if (loadQ().length >= MIN_REFILL) break;
        }
      }
    }
  }

  async function ensureQ(){
    if (loadQ().length < MIN_REFILL){
      await refillScience();
    }
  }

  function paint(it){
    if (!it) return;
    // 成功時は余計な固定文は付けない（毎回同じ文字列をやめる）
    if (tEl) tEl.textContent = `【 ${safe(it.title,'')} 】`;
    if (bEl) bEl.textContent = safe(it.extract, "");
    // カウントと既読・24件ユニークの記録
    const cnt = firstNCount();
    const title = safe(it.title,'');
    pushSeen(title);
    if (cnt < FIRST_N){
      pushFirstNTitle(title);
      setFirstNCount(cnt + 1);
    }
  }

  async function serve(){
    await ensureQ();
    // 24件ユニーク保証：必要な間は重複をスキップして取り直す
    const seenSet = new Set(jget(SEEN_KEY,[]));
    const firstNset = firstNTitles();
    let it = null;
    for (let guard=0; guard<MAX_QUEUE; guard++){
      const cand = dequeue(); if (!cand) break;
      const title = safe(cand.title,'');
      const needUnique = firstNCount() < FIRST_N;
      if (seenSet.has(title)) continue;
      if (needUnique && firstNset.has(title)) continue;
      it = cand; break;
    }
    if (!it){
      // キューが尽きた/重複しかない → 再補充してもう一度
      await refillScience();
      for (let guard=0; guard<MAX_QUEUE; guard++){
        const cand = dequeue(); if (!cand) break;
        const title = safe(cand.title,'');
        const needUnique = firstNCount() < FIRST_N;
        if (seenSet.has(title)) continue;
        if (needUnique && firstNset.has(title)) continue;
        it = cand; break;
      }
    }
    if (it) paint(it);
  }

  function hook(){
    // 初期表示
    setTimeout(serve, 60);
    // NEXT/RELATED 後
    ["nextBtn","next","relBtn","relatedBtn"].forEach(id=>{
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', ()=> setTimeout(serve, 40));
    });
  }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", hook, {once:true});
  else hook();
})();
// === end v19.22 =============================================================
