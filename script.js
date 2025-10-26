// v20.3: genre whitelist + subcategory BFS + de-dup text + startup diversity
(function(){
const $=s=>document.querySelector(s);
const titleBox=$("#title"),blurbBox=$("#blurb"),genreSel=$("#genreSel");
const detailBtn=$("#detailBtn"),relatedBtn=$("#relatedBtn"),openBtn=$("#openBtn"),
      nextBtn=$("#nextBtn"),backBtn=$("#backBtn"),clearBtn=$("#clearBtn"),
      maintext=$("#maintext"),altview=$("#altview");
let current=null;const V='v20_3';

// persistent install id (startup diversity across reinstalls)
if(!localStorage.getItem('siren_install_id')){
  localStorage.setItem('siren_install_id',[Date.now().toString(36),crypto.getRandomValues(new Uint32Array(1))[0].toString(36)].join('-'));
}
const INSTALL_ID = localStorage.getItem('siren_install_id');

// storage keys
const SEEN_TITLES='seen_titles_'+V, SEEN_BLURBS='seen_blurbs_'+V, DAY_KEY='seen_day_'+V;
const CURSOR_KEY='cat_cursor_'+V; // per-subcat cursor
const RECENT_TITLES='recent_titles_'+V; // last 40 titles to avoid immediate repeats

// daily reset (keep last 5k)
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function loadJ(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f))}catch{return f}}
function saveJ(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
(function dailyReset(){
  const last=localStorage.getItem(DAY_KEY), now=today();
  if(last!==now){
    saveJ(SEEN_TITLES, loadJ(SEEN_TITLES, []).slice(-5000));
    saveJ(SEEN_BLURBS, loadJ(SEEN_BLURBS, []).slice(-5000));
    localStorage.setItem(DAY_KEY, now);
  }
})();
let seenTitles=new Set(loadJ(SEEN_TITLES,[]));
let seenBlurbs=new Set(loadJ(SEEN_BLURBS,[]));
let recentTitles=loadJ(RECENT_TITLES,[]);
let cursorMap=loadJ(CURSOR_KEY,{});

// genre -> whitelist category prefixes (Japanese Wikipedia)
const GENRE_WHITELIST = {
  "科学": [
    "Category:科学","Category:物理学","Category:化学","Category:生物学","Category:地学",
    "Category:天文学","Category:統計学","Category:気象学","Category:工学","Category:計算機科学",
    "Category:神経科学","Category:環境科学","Category:材料科学","Category:数理科学","Category:認知科学"
  ],
  "数学": ["Category:数学","Category:幾何学","Category:代数学","Category:解析学","Category:確率論","Category:統計学","Category:数理論理学"],
  "技術": ["Category:工学","Category:電気工学","Category:機械工学","Category:情報工学","Category:土木工学","Category:建築学","Category:ソフトウェア"],
  "哲学": ["Category:哲学","Category:倫理学","Category:形而上学","Category:認識論","Category:美学","Category:論理学"],
  "芸術": ["Category:芸術","Category:美術","Category:音楽","Category:映画","Category:写真","Category:デザイン","Category:建築"],
  "言語学": ["Category:言語学","Category:音声学","Category:意味論","Category:統語論","Category:語用論","Category:形態論"],
  "心理学": ["Category:心理学","Category:認知科学","Category:神経科学"],
  "歴史": ["Category:歴史","Category:日本の歴史","Category:世界の歴史","Category:考古学"],
  "文学": ["Category:文学","Category:小説","Category:詩","Category:批評","Category:比較文学"]
};

// helper
function bust(u){return u+(u.includes('?')?'&':'?')+'t='+Date.now()}
async function jget(u){
  const controller=new AbortController(); const id=setTimeout(()=>controller.abort(),10000);
  try{
    const res=await fetch(bust(u),{mode:'cors',headers:{'Accept':'application/json'},cache:'no-store',signal:controller.signal});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const ct=res.headers.get('content-type')||''; if(!ct.includes('application/json')) throw new Error('Non-JSON');
    return await res.json();
  } finally { clearTimeout(id); }
}
function norm(d){
  const t=d.title||'（無題）';
  const bl=d.description?`${d.description}`:(d.extract?(d.extract.split('。')[0]+'。'):'（概要なし）');
  const det=d.extract||'（詳細なし）';
  const url=(d.content_urls&&d.content_urls.desktop)?d.content_urls.desktop.page:('https://ja.wikipedia.org/wiki/'+encodeURIComponent(t));
  return {title:t,blurb:bl,detail:det,url};
}
function esc(str){return String(str).replace(/[&<>"']/g,s=>s==='&'?'&amp;':s==='<'?'&lt;':s==='>'?'&gt;':s==='"'?'&quot;':'&#39;')}
async function sSeed(){
  const n=Math.floor(Date.now()/1e3),p=(performance.now()*1e3|0)&0xffffffff,r=crypto.getRandomValues(new Uint32Array(2)),u=navigator.userAgent+INSTALL_ID;
  const b=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${n}|${p}|${r[0]}|${r[1]}|${u}`));
  const dv=new DataView(b); return (BigInt(dv.getUint32(0))<<32n)|BigInt(dv.getUint32(4));
}
function m32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function shuffle(a,s){const r=m32(Number(s&0xffffffffn)||1);for(let i=a.length-1;i>0;i--){const j=(r()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]]}return a}

// category paging (members)
async function catMembers(cat, cont=""){
  const u='https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle='+encodeURIComponent(cat)+'&cmtype=page&cmnamespace=0&cmlimit=100&origin=*'+(cont?('&cmcontinue='+encodeURIComponent(cont)):'');
  const d=await jget(u);
  const m=(d.query&&d.query.categorymembers)||[];
  const next=(d.continue&&d.continue.cmcontinue)||"";
  return {titles:m.map(x=>x.title), cont: next};
}
// categories for a title (to enforce whitelist)
async function titleCats(title){
  const u='https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles='+encodeURIComponent(title)+'&origin=*';
  const d=await jget(u);
  const pages=d.query&&d.query.pages?Object.values(d.query.pages):[];
  const cats=pages.length?(pages[0].categories||[]):[];
  return cats.map(c=>c.title);
}
function allowedByWhitelist(genre, cats){
  const wl = GENRE_WHITELIST[genre] || [];
  if(!wl.length) return true; // no restriction
  return cats.some(c => wl.some(prefix => c.startsWith(prefix)));
}

// Fetch titles for a genre using whitelist categories (multi roots), round-robin across roots
async function titlesForGenre(genre, seed, need=80){
  const roots = GENRE_WHITELIST[genre] || [];
  if(!roots.length) return []; // fallback elsewhere
  // pick a start root using seed & install id for diversity
  const start = Number(seed & 0xffffffffn) % roots.length;
  const order = roots.slice(start).concat(roots.slice(0,start));

  let acc=[];
  for(const root of order){
    const cur = (cursorMap[root]||"");
    const {titles, cont} = await catMembers(root, cur);
    cursorMap[root]=cont||""; saveJ(CURSOR_KEY, cursorMap);
    // verify whitelist by checking categories (sample first 50 to limit traffic)
    for(const t of titles){
      if(seenTitles.has(t)) continue;
      try{
        const cats = await titleCats(t);
        if(allowedByWhitelist(genre, cats)) acc.push(t);
      }catch{}
      if(acc.length>=need) break;
    }
    if(acc.length>=need) break;
  }
  shuffle(acc, seed^0x9abcdn);
  // avoid very recent repeats
  acc = acc.filter(t => recentTitles.indexOf(t) === -1);
  return acc;
}

async function rndTitles(n=60){
  const d=await jget('https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit='+n+'&origin=*');
  return ((d.query&&d.query.random)||[]).map(x=>x.title);
}
async function sumByTitle(t){ return norm(await jget('https://ja.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(t))); }
async function relRobust(t){
  try{ const d=await jget('https://ja.wikipedia.org/api/rest_v1/page/related/'+encodeURIComponent(t)); const r=(d.pages||[]).map(norm); if(r&&r.length) return r; }catch{}
  try{ const d=await jget('https://ja.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch='+encodeURIComponent('morelike:\"'+t+'\"')+'&srlimit=9&srnamespace=0&origin=*'); const hits=(d.query&&d.query.search)||[]; const ts=hits.map(h=>h.title).filter(Boolean); const out=[]; for(const x of ts){ try{ out.push(await sumByTitle(x)); }catch{} } if(out.length) return out; }catch{}
  try{ const d=await jget('https://ja.wikipedia.org/w/api.php?action=parse&format=json&page='+encodeURIComponent(t)+'&prop=links&origin=*'); const links=(d.parse&&d.parse.links)||[]; const ts=links.filter(l=>l.ns===0&&l['*']).slice(0,12).map(l=>l['*']); const out=[]; for(const x of ts){ try{ out.push(await sumByTitle(x)); }catch{} } if(out.length) return out; }catch{}
  try{ const d=await jget('https://ja.wikipedia.org/w/api.php?action=opensearch&format=json&search='+encodeURIComponent(t)+'&limit=9&namespace=0&origin=*'); const ts=Array.isArray(d)&&Array.isArray(d[1])?d[1]:[]; const out=[]; for(const x of ts){ try{ out.push(await sumByTitle(x)); }catch{} } if(out.length) return out; }catch{}
  try{ const d=await jget('https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles='+encodeURIComponent(t)+'&origin=*'); const pages=d.query&&d.query.pages?Object.values(d.query.pages):[]; const cats=pages.length?(pages[0].categories||[]):[]; if(cats.length){ const cat=cats[0].title; const d2=await jget('https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle='+encodeURIComponent(cat)+'&cmtype=page&cmnamespace=0&cmlimit=9&origin=*'); const mem=(d2.query&&d2.query.categorymembers)||[]; const ts=mem.map(m=>m.title).filter(Boolean); const out=[]; for(const x of ts){ try{ out.push(await sumByTitle(x)); }catch{} } if(out.length) return out; } }catch{}
  return [];
}

// heuristics to avoid repeated-looking blurbs
function canonicalBlurb(s){ return s.replace(/\s+/g,'').replace(/[「」『』（）()［］\[\]、。・,\.]/g,'').toLowerCase(); }

function showMain(){ maintext.hidden=false; altview.hidden=true; backBtn.hidden=true; }
function showAlt(h){ altview.innerHTML=h; maintext.hidden=true; altview.hidden=false; backBtn.hidden=false; }
function renderMain(s){ titleBox.textContent=`【 ${s.title} 】`; blurbBox.textContent=s.blurb; showMain(); }

async function pickNew(){
  const g=genreSel.value; const seed=await sSeed();
  let candidates=[];
  if(g==='all'){
    const r = await rndTitles(80);
    candidates = r.filter(t=>!seenTitles.has(t) && recentTitles.indexOf(t)===-1);
    shuffle(candidates, seed);
  }else{
    candidates = await titlesForGenre(g, seed, 80);
  }
  // fallback mixing
  let tries=0;
  while(candidates.length===0 && tries<3){
    tries++;
    const mix = await rndTitles(60);
    shuffle(mix, seed + BigInt(tries));
    candidates = mix.filter(t=>!seenTitles.has(t) && recentTitles.indexOf(t)===-1);
  }
  if(!candidates.length) return null;

  // pick first that passes blurb uniqueness
  for(const t of candidates){
    try{
      const s = await sumByTitle(t);
      const cb = canonicalBlurb(s.blurb);
      if(cb.length < 6) continue; // too trivial
      if(seenBlurbs.has(cb)) continue;
      // genre enforcement at display-time too
      if(g!=='all'){
        const cats = await titleCats(s.title);
        if(!allowedByWhitelist(g, cats)) continue;
      }
      return s;
    }catch{}
  }
  return null;
}

async function showOne(){
  const s=await pickNew();
  if(!s){ titleBox.textContent='（候補が見つかりません）'; blurbBox.textContent='ジャンルを変えるか、少し時間をおいて再試行してください。'; showMain(); return; }
  current=s;
  const cb = canonicalBlurb(s.blurb);
  seenTitles.add(s.title); saveJ(SEEN_TITLES, Array.from(seenTitles).slice(-100000));
  seenBlurbs.add(cb);      saveJ(SEEN_BLURBS, Array.from(seenBlurbs).slice(-100000));
  recentTitles = (recentTitles.concat([s.title])).slice(-40); saveJ(RECENT_TITLES, recentTitles);
  renderMain(s);
}

// events
document.addEventListener('DOMContentLoaded', () => {
  nextBtn.addEventListener('click',showOne);
  backBtn.addEventListener('click',showMain);
  clearBtn.addEventListener('click',()=>{ if(!altview.hidden) showMain(); });
  detailBtn.addEventListener('click',()=>{ if(!current) return;
    showAlt(`<h3>DETAIL</h3>${esc(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`);
  });
  relatedBtn.addEventListener('click', async()=>{
    if(!current) return;
    showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
    try{
      const rel=await relRobust(current.title);
      if(!rel.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
      const items=rel.slice(0,9).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${esc(p.title)}</a></li>`).join("");
      showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
    }catch{
      showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
    }
  });
  openBtn.addEventListener('click',()=>{
    const u=current?.url||(current?.title?('https://ja.wikipedia.org/wiki/'+encodeURIComponent(current.title)):null);
    if(u) window.open(u,'_blank','noopener');
  });

  setTimeout(showOne, 300); // faster boot
  if(location.protocol.startsWith('http')&&'serviceWorker'in navigator){
    navigator.serviceWorker.register('./serviceWorker.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{});
  }
});
})();