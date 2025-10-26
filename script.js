
// ========= Utilities =========
const $ = s => document.querySelector(s);
const titleBox = $("#titleBox");
const blurbBox = $("#blurbBox");
const nextBtn = $("#nextBtn");
const moreBtn = $("#moreBtn");
const relBtn  = $("#relBtn");
const openBtn = $("#openBtn");
const clearBtn= $("#clearBtn");

function loadJSON(key, def){ try{ return JSON.parse(localStorage.getItem(key) ?? "null") ?? def; }catch{ return def; } }
function saveJSON(key, v){ localStorage.setItem(key, JSON.stringify(v)); }
function bust(url){ const d = url.includes("?") ? "&" : "?"; return url + d + "_=" + (Math.random().toString(36).slice(2)); }

// ========= Cooldown =========
const LAST_RUN_KEY = "siren_last_run";
function cooldownOk(ms=1200){
  const last = Number(localStorage.getItem(LAST_RUN_KEY) || 0);
  const ok = Date.now() - last >= ms;
  if (ok) localStorage.setItem(LAST_RUN_KEY, String(Date.now()));
  return ok;
}

// ========= Seen memory =========
const SEEN_KEY = "siren_seen_titles_v19_6";
const SEEN_LIMIT = 800;
let seenSet = new Set(loadJSON(SEEN_KEY, []));
function saveSeen(){
  if (seenSet.size > SEEN_LIMIT){
    const keep = Array.from(seenSet).slice(-Math.floor(SEEN_LIMIT*0.6));
    seenSet = new Set(keep);
  }
  saveJSON(SEEN_KEY, Array.from(seenSet));
}

// ========= Fallbacks =========
const LOCAL_FALLBACK = [
  { title:"月", blurb:"地球の唯一の自然衛星。", detail:"月は地球の唯一の自然衛星で、公転周期は約27.3日。満ち欠けは太陽・地球・月の位置関係で生じます。", url:"https://ja.wikipedia.org/wiki/%E6%9C%88" },
  { title:"音階", blurb:"音楽を構成する高さの体系。", detail:"長調・短調をはじめ様々なスケールがあり、文化圏によって体系が異なります。", url:"https://ja.wikipedia.org/wiki/%E9%9F%B3%E9%9A%8E" },
  { title:"色彩理論", blurb:"色の見えと調和の学理。", detail:"減法混色・加法混色、色相環、補色関係などが含まれます。", url:"https://ja.wikipedia.org/wiki/%E8%89%B2%E5%BD%A9%E5%AD%A6" }
];

// ========= Robust fetch =========
async function fetchJSON(url, {timeoutMs=8000, retries=3, backoff=600} = {}){
  let lastErr = null;
  for (let attempt=0; attempt<=retries; attempt++){
    const ctrl = new AbortController();
    const timer = setTimeout(()=>ctrl.abort(), timeoutMs);
    try{
      const res = await fetch(bust(url), {
        mode: "cors",
        headers: { "Accept": "application/json, */*;q=0.1" },
        cache: "no-store",
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok){
        if (res.status===429 || res.status===503){
          await new Promise(r=>setTimeout(r, backoff * (attempt+1)));
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const ct = (res.headers.get('content-type')||'').toLowerCase();
      if (!ct.includes('application/json')){
        await new Promise(r=>setTimeout(r, backoff * (attempt+1)));
        continue;
      }
      return await res.json();
    }catch(e){
      clearTimeout(timer);
      lastErr = e;
      await new Promise(r=>setTimeout(r, backoff * (attempt+1)));
    }
  }
  throw lastErr || new Error("fetch failed");
}

// ========= Wikipedia helpers =========
// Use ja.wikipedia REST API
async function getRandomSummary(){
  const data = await fetchJSON("https://ja.wikipedia.org/api/rest_v1/page/random/summary");
  return {
    title: data.title,
    blurb: data.extract || "",
    detail: data.extract || "",
    url: data.content_urls?.desktop?.page || ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(data.title))
  };
}
async function getRelatedSummary(title){
  const q = encodeURIComponent(title);
  const data = await fetchJSON(`https://ja.wikipedia.org/api/rest_v1/page/summary/${q}`);
  const related = await fetchJSON(`https://ja.wikipedia.org/api/rest_v1/page/related/${q}`);
  const picks = (related?.pages || []).filter(p => p?.title && !seenSet.has(p.title));
  const p = picks[Math.floor(Math.random()*Math.max(1,picks.length))] || related?.pages?.[0];
  if (p){
    return {
      title: p.title,
      blurb: p.extract || "",
      detail: p.extract || "",
      url: p.content_urls?.desktop?.page || ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(p.title))
    };
  }
  return {
    title: data.title,
    blurb: data.extract || "",
    detail: data.extract || "",
    url: data.content_urls?.desktop?.page || ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(data.title))
  };
}

// ========= UI Logic =========
let current = loadJSON("siren_last_ok", null);

function showMain(){
  // nothing fancy for now
}

async function pickNew(){
  // try random; skip seen titles a few times
  for (let i=0;i<6;i++){
    const s = await getRandomSummary();
    if (!seenSet.has(s.title)) return s;
  }
  // if everything looks seen, just return latest
  return await getRandomSummary();
}

async function showOne(){
  if (!cooldownOk()) return;
  titleBox.textContent = "読み込み中…";
  blurbBox.textContent = "接続状況を確認しています";
  showMain();

  try{
    const s = await pickNew();
    if (!s) throw new Error("no-candidate");
    current = s;
    seenSet.add(s.title); saveSeen();
    titleBox.textContent = `【 ${s.title} 】`;
    blurbBox.textContent = s.blurb;
  }catch(e){
    const lastOk = loadJSON("siren_last_ok", null);
    const fb = lastOk || LOCAL_FALLBACK[(Math.random()*LOCAL_FALLBACK.length)|0];
    current = fb;
    titleBox.textContent = `【 ${fb.title} 】`;
    blurbBox.textContent = fb.blurb + "（フォールバック）";
  }finally{
    if (current) saveJSON("siren_last_ok", current);
    showMain();
  }
}

async function showMore(){
  if (!current) return showOne();
  blurbBox.textContent = (current.detail || current.blurb || "") + "";
}
async function showRelated(){
  if (!current) return showOne();
  try{
    const s = await getRelatedSummary(current.title);
    current = s;
    seenSet.add(s.title); saveSeen();
    titleBox.textContent = `【 ${s.title} 】`;
    blurbBox.textContent = s.blurb;
    saveJSON("siren_last_ok", current);
  }catch(e){
    // degrade gracefully
    showMore();
  }
}

function openWiki(){
  if (current?.url) window.open(current.url, "_blank", "noopener");
}

function setupClearLongPress(){
  let t=null;
  clearBtn.addEventListener('mousedown', ()=>{
    t=setTimeout(()=>{
      localStorage.removeItem(SEEN_KEY);
      localStorage.removeItem("siren_last_ok");
      localStorage.removeItem(LAST_RUN_KEY);
      seenSet = new Set();
      titleBox.textContent = "（メモリを初期化しました）";
      blurbBox.textContent = "NEXT を押してください。";
    }, 1200);
  });
  clearBtn.addEventListener('mouseup', ()=>{ if(t){clearTimeout(t); t=null;} });
  clearBtn.addEventListener('mouseleave', ()=>{ if(t){clearTimeout(t); t=null;} });
}

nextBtn.addEventListener('click', showOne);
moreBtn.addEventListener('click', showMore);
relBtn.addEventListener('click', showRelated);
openBtn.addEventListener('click', openWiki);
setupClearLongPress();

// First paint
if (current){
  titleBox.textContent = `【 ${current.title} 】`;
  blurbBox.textContent = current.blurb;
} else {
  titleBox.textContent = "—";
  blurbBox.textContent = "NEXT を押してください。";
}
