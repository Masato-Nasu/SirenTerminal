// v19.7: 決定的キュー&枯渇時の安全リサイクル（"候補が見つかりません" を出さない）
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

// ---- 永続キー ----
const STORE_PREFIX = "siren_v19_7_";
const SEEN_KEY = STORE_PREFIX + "seen";              // Array<string>
const QUEUE_KEY = STORE_PREFIX + "queues";           // { [genre]: {titles:string[], idx:number, updated:number} }
const MAX_SEEN = 2000;                               // 見たことあるタイトルの保存上限
const RECYCLE_AFTER = 200;                           // 直近200件は避けるが、それ以降は再表示OK
const QUEUE_MIN = 8;                                 // キューがこれ未満になったら補充
const QUEUE_TARGET = 60;                             // 補充時に目標本数
const QUEUE_STALE_MS = 1000*60*60*6;                // 6hでジャンルキューを刷新

// ---- 小物 ----
function jget(k, d){ try{ return JSON.parse(localStorage.getItem(k) ?? JSON.stringify(d)); }catch{return d;} }
function jset(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function now(){ return Date.now(); }
function uniq(arr){ return Array.from(new Set(arr)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function rotate(arr){ if (!arr.length) return null; const x=arr.shift(); arr.push(x); return x; }
function escapeHtml(str){ return String(str).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function bust(u){ const sep = u.includes('?') ? '&' : '?'; return `${u}${sep}t=${Date.now()}`; }

// ---- ストア ----
let seen = jget(SEEN_KEY, []);
let queues = jget(QUEUE_KEY, {});
function seenAdd(title){
  seen.push(title);
  if (seen.length > MAX_SEEN) seen = seen.slice(-MAX_SEEN);
  jset(SEEN_KEY, seen);
}
function getQueue(genre){
  if (!queues[genre]) queues[genre] = {titles:[], idx:0, updated:0};
  return queues[genre];
}
function saveQueues(){ jset(QUEUE_KEY, queues); }

// ---- fetch JSON with timeout/retries ----
async function fetchJSON(url, {timeoutMs=8000, retries=2} = {}){
  let lastErr=null;
  for(let a=0;a<=retries;a++){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      const res=await fetch(bust(url), {mode:"cors",headers:{"Accept":"application/json"},cache:"no-store",signal:ctrl.signal});
      clearTimeout(timer);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct=(res.headers.get('content-type')||'').toLowerCase();
      if(!ct.includes('application/json')) throw new Error("Non-JSON");
      return await res.json();
    }catch(e){ clearTimeout(timer); lastErr=e; await new Promise(r=>setTimeout(r, 250+250*a)); }
  }
  throw lastErr || new Error("fetch failed");
}

// ---- Wikipedia helpers ----
function normalizeSummary(data){
  const title = data.title || "（無題）";
  const blurb = data.description ? `${data.description}` : (data.extract ? (data.extract.split("。")[0] + "。") : "（概要なし）");
  const detail = data.extract || "（詳細なし）";
  const url = (data.content_urls && data.content_urls.desktop) ? data.content_urls.desktop.page : ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(title));
  return { title, blurb, detail, url };
}
async function fetchSummaryByTitle(title){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title));
  return normalizeSummary(data);
}
async function fetchRandomTitles(limit=40){
  const data = await fetchJSON("https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit="+limit+"&origin=*");
  const arr = (data.query && data.query.random) ? data.query.random : [];
  return arr.map(x => x.title);
}
async function fetchCategoryBatch(catTitle, cmcontinue=""){
  const url = "https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=" + encodeURIComponent("Category:"+catTitle) + "&cmtype=page&cmnamespace=0&cmlimit=100&origin=*" + (cmcontinue ? "&cmcontinue="+encodeURIComponent(cmcontinue) : "");
  const data = await fetchJSON(url);
  const members = (data.query && data.query.categorymembers) ? data.query.categorymembers : [];
  const cont = (data.continue && data.continue.cmcontinue) ? data.continue.cmcontinue : "";
  return { titles: members.map(m=>m.title), cont };
}
async function collectGenreTitles(genre, target=QUEUE_TARGET){
  if (genre==="all"){
    const a = await fetchRandomTitles(target);
    return uniq(a);
  }
  let out=[]; let cont=""; let guard=0;
  while(out.length<target && guard<8){
    guard++;
    const r = await fetchCategoryBatch(genre, cont);
    cont = r.cont;
    out = uniq(out.concat(r.titles));
    if (!cont) break;
  }
  // 足りない分はランダムで補う（完全枯渇防止）
  if (out.length < Math.floor(target*0.6)){
    const fill = await fetchRandomTitles(target - out.length);
    out = uniq(out.concat(fill));
  }
  return out;
}

// ---- Queue maintenance ----
async function ensureQueue(genre){
  const q = getQueue(genre);
  const tooOld = (now() - q.updated) > QUEUE_STALE_MS;
  if (q.titles.length < QUEUE_MIN || tooOld){
    try{
      const titles = await collectGenreTitles(genre, QUEUE_TARGET);
      // 直近RECYCLE_AFTER件は除外して補充
      const recent = new Set(seen.slice(-RECYCLE_AFTER));
      const filtered = titles.filter(t => !recent.has(t));
      q.titles = uniq(filtered.concat(q.titles)).slice(0, QUEUE_TARGET);
      q.idx = 0;
      q.updated = now();
      saveQueues();
    }catch(e){
      // 取得失敗でも直近履歴から再生産（空白を出さない）
      const recent = uniq(seen.slice(-QUEUE_TARGET).reverse());
      if (recent.length){
        q.titles = recent;
        q.idx = 0;
        q.updated = now();
        saveQueues();
      }
    }
  }
  return q;
}

// ---- pick next title deterministically ----
async function nextTitle(genre){
  const q = await ensureQueue(genre);
  if (!q.titles.length){
    // 最終手段：RESTの random/summary
    try{
      const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/random/summary");
      return normalizeSummary(d);
    }catch{ return null; }
  }
  const title = q.titles[q.idx % q.titles.length];
  q.idx = (q.idx + 1) % Math.max(1, q.titles.length);
  saveQueues();
  try{
    const s = await fetchSummaryByTitle(title);
    return s;
  }catch(e){
    // 壊れタイトルの場合はスキップして次
    q.titles.splice(q.idx-1,1);
    saveQueues();
    return await nextTitle(genre);
  }
}

// ---- UI ----
function showMain(){ maintext.hidden=false; altview.hidden=true; backBtn.hidden=true; }
function showAlt(html){ altview.innerHTML=html; maintext.hidden=true; altview.hidden=false; backBtn.hidden=false; }

async function showOne(){
  titleBox.textContent = "読み込み中…";
  blurbBox.textContent = "接続状況を確認しています";
  showMain();
  try{
    const s = await nextTitle(genreSel.value);
    if (!s){
      // ここには基本来ないが、来ても空白は出さない
      titleBox.textContent = "（取得に失敗）";
      blurbBox.textContent = "ネットワーク状態をご確認ください。";
      return;
    }
    current = s;
    seenAdd(s.title);
    titleBox.textContent = `【 ${s.title} 】`;
    blurbBox.textContent = s.blurb;
  }catch(e){
    titleBox.textContent = "（取得に失敗しました）";
    blurbBox.textContent = "しばらくしてから MORE / NEXT をお試しください。";
  }finally{
    showMain();
  }
}

// ---- BUTTONS ----
detailBtn.addEventListener('click', () => {
  if (!current) return;
  const html = `<h3>DETAIL</h3>${escapeHtml(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`;
  showAlt(html);
});
relatedBtn.addEventListener('click', async () => {
  if (!current) return;
  showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
  try {
    const d = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/related/" + encodeURIComponent(current.title));
    const r = (d.pages || []).map(p => normalizeSummary(p));
    if (!r.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
    const items = r.slice(0,9).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></li>`).join("");
    showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
  } catch(e){
    showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
  }
});
openBtn.addEventListener('click', () => { const url = current?.url || (current?.title ? "https://ja.wikipedia.org/wiki/" + encodeURIComponent(current.title) : null); if (url) window.open(url, '_blank', 'noopener'); });
nextBtn.addEventListener('click', () => { showOne(); });
backBtn.addEventListener('click', () => { showMain(); });
clearBtn.addEventListener('click', () => { if (!altview.hidden) showMain(); });

setTimeout(()=>{ showOne(); }, 300);

if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ if (reg && reg.update) reg.update(); }).catch(()=>{});
}
