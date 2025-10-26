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



// === v19.8 additions: cooldown, circuit breaker, graceful local fallback ===
const LAST_RUN_KEY = "siren_last_run_v19_8";
function cooldownOk(ms=1000){
  const last = Number(localStorage.getItem(LAST_RUN_KEY) || 0);
  const ok = Date.now() - last >= ms;
  if (ok) localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
  return ok;
}

// circuit breaker: after a failure we enter 'local-only' for a short time
const CB_KEY = "siren_cb_until_v19_8";
function inBreaker(){ return Date.now() < Number(localStorage.getItem(CB_KEY) || 0); }
function tripBreaker(ms=90000){ localStorage.setItem(CB_KEY, String(Date.now()+ms)); }
function resetBreaker(){ localStorage.removeItem(CB_KEY); }

// local minimal fallback dataset
const LOCAL_FALLBACK = [
  { title:"月", blurb:"地球の唯一の自然衛星。", detail:"公転約27.3日。満ち欠けは位置関係で生じる。", url:"https://ja.wikipedia.org/wiki/%E6%9C%88" },
  { title:"テレミン", blurb:"触れずに演奏する電子楽器。", detail:"手の位置で音程と音量を制御。", url:"https://ja.wikipedia.org/wiki/%E3%83%86%E3%83%AC%E3%83%9F%E3%83%B3" },
  { title:"反応拡散系", blurb:"模様形成を記述する数理モデル。", detail:"チューリングの提案。縞や斑点を再現。", url:"https://ja.wikipedia.org/wiki/%E5%8F%8D%E5%BF%9C%E6%8B%A1%E6%95%A3%E6%96%B9%E7%A8%8B%E5%BC%8F" }
];

// keep references created by original file if present
try{
  if (typeof titleBox === "undefined") window.titleBox = document.getElementById('title');
  if (typeof blurbBox === "undefined") window.blurbBox = document.getElementById('blurb');
}catch{}

// Wrap original fetchJSON to add retries and content-type guard if needed
(function(){
  const _origFetchJSON = typeof fetchJSON === "function" ? fetchJSON : null;
  window.fetchJSON = async function(url, opts={}){
    const o = Object.assign({timeoutMs:8000, retries:2}, opts||{});
    if (_origFetchJSON){
      try{ return await _origFetchJSON(url, o); }catch(e){ /* fall through */ }
    }
    // generic robust fetch
    let lastErr=null;
    for (let a=0; a<=o.retries; a++){
      const ctrl = new AbortController();
      const timer = setTimeout(()=>ctrl.abort(), o.timeoutMs);
      try{
        const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(), {
          mode:"cors", headers:{ "Accept":"application/json,*/*;q=0.1" }, cache:"no-store", signal:ctrl.signal
        });
        clearTimeout(timer);
        if (!res.ok){ if (res.status===429 || res.status===503){ await new Promise(r=>setTimeout(r, 400*(a+1))); continue; } throw new Error('HTTP '+res.status); }
        const ct = (res.headers.get('content-type')||'').toLowerCase();
        if (!ct.includes('application/json')){ await new Promise(r=>setTimeout(r, 400*(a+1))); continue; }
        const j = await res.json();
        resetBreaker();
        return j;
      }catch(e){
        clearTimeout(timer);
        lastErr=e;
      }
    }
    tripBreaker();
    throw (lastErr || new Error("fetch failed"));
  };
})();

// Provide safe wrappers the original code can call
window.__sirenLocalPick = function(currentTitle){
  // pick an item from local fallback that's not the same title if possible
  const arr = LOCAL_FALLBACK.slice();
  for (let i=0;i<6;i++){
    const p = arr[(Math.random()*arr.length)|0];
    if (!currentTitle || p.title !== currentTitle) return p;
  }
  return arr[0];
};

// Patch NEXT/MORE/RELATED handlers if they exist
(function(){
  // If original exposed showOne() etc., wrap them to add cooldown+fallback.
  const _showOne = typeof showOne === "function" ? showOne : null;
  window.showOne = async function(){
    if (!cooldownOk()) return;
    if (titleBox && blurbBox){
      titleBox.textContent = "読み込み中…";
      blurbBox.textContent = "接続状況を確認しています";
    }
    if (inBreaker()){ // local-only
      const s = __sirenLocalPick();
      window.current = s;
      if (titleBox) titleBox.textContent = `【 ${s.title} 】`;
      if (blurbBox) blurbBox.textContent = s.blurb;
      return;
    }
    try{
      return await _showOne?.();
    }catch(e){
      const s = __sirenLocalPick();
      window.current = s;
      if (titleBox) titleBox.textContent = `【 ${s.title} 】`;
      if (blurbBox) blurbBox.textContent = s.blurb + "（フォールバック）";
    }
  };

  const _related = typeof (relatedBtn?.onclick) === "function" ? relatedBtn.onclick : null;
  if (relatedBtn){
    relatedBtn.addEventListener('click', async (ev)=>{
      if (!cooldownOk()) return;
      if (inBreaker()){
        const s = __sirenLocalPick(window.current?.title);
        window.current = s;
        if (titleBox) titleBox.textContent = `【 ${s.title} 】`;
        if (blurbBox) blurbBox.textContent = s.blurb;
        return;
      }
      try{
        if (_related) return _related(ev);
      }catch(e){
        const s = __sirenLocalPick(window.current?.title);
        window.current = s;
        if (titleBox) titleBox.textContent = `【 ${s.title} 】`;
        if (blurbBox) blurbBox.textContent = s.blurb + "（フォールバック）";
      }
    }, { once:false });
  }
})();
