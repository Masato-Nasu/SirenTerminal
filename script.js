// v20.4: genre fast whitelist + parallel checks + loading state + 7s guard
(function(){
const $=s=>document.querySelector(s);
const titleBox=$("#title"),blurbBox=$("#blurb"),genreSel=$("#genreSel");
const detailBtn=$("#detailBtn"),relatedBtn=$("#relatedBtn"),openBtn=$("#openBtn"),
      nextBtn=$("#nextBtn"),backBtn=$("#backBtn"),clearBtn=$("#clearBtn"),
      maintext=$("#maintext"),altview=$("#altview");
let current=null;const V='v20_4';

// install id for diversity
if(!localStorage.getItem('siren_install_id')){
  localStorage.setItem('siren_install_id',[Date.now().toString(36),crypto.getRandomValues(new Uint32Array(1))[0].toString(36)].join('-'));
}
const INSTALL_ID = localStorage.getItem('siren_install_id');

// storage keys
const SEEN_TITLES='seen_titles_'+V, SEEN_BLURBS='seen_blurbs_'+V, DAY_KEY='seen_day_'+V;
const CURSOR_KEY='cat_cursor_'+V; const RECENT_TITLES='recent_titles_'+V;
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

// whitelist roots
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
  const n=Math.floor(Date.now()/1e3),p=(performance.now()*1e3|0)&0xffffffff,r=crypto.getRandomValues(new Uint32Array(2)),u=navigator.userAgent+localStorage.getItem('siren_install_id');
  const b=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${n}|${p}|${r[0]}|${r[1]}|${u}`)); const dv=new DataView(b);
  return (BigInt(dv.getUint32(0))<<32n)|BigInt(dv.getUint32(4));
}
function m32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function shuffle(a,s){const r=m32(Number(s&0xffffffffn)||1);for(let i=a.length-1;i>0;i--){const j=(r()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]]}return a}

async function catMembers(cat, cont=""){
  const u='https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle='+encodeURIComponent(cat)+'&cmtype=page&cmnamespace=0&cmlimit=100&origin=*'+(cont?('&cmcontinue='+encodeURIComponent(cont)):'');
  const d=await jget(u);
  const m=(d.query&&d.query.categorymembers)||[];
  const next=(d.continue&&d.continue.cmcontinue)||"";
  return {titles:m.map(x=>x.title), cont: next};
}
async function titleCats(title){
  const u='https://ja.wikipedia.org/w/api.php?action=query&format=json&prop=categories&clshow=!hidden&titles='+encodeURIComponent(title)+'&origin=*';
  const d=await jget(u);
  const pages=d.query&&d.query.pages?Object.values(d.query.pages):[];
  const cats=pages.length?(pages[0].categories||[]):[];
  return cats.map(c=>c.title);
}
function allowedByWhitelist(genre, cats){
  const wl = GENRE_WHITELIST[genre] || [];
  if(!wl.length) return true;
  return cats.some(c => wl.some(prefix => c.startsWith(prefix)));
}

// 並列検証（最大10並列）＋早期打ち切り
async function filterAllowedParallel(genre, titles, need=80, sampleLimit=25){
  const allowed=[]; let i=0;
  const limit = 10;
  async function worker(){
    while(i<Math.min(titles.length, sampleLimit) && allowed.length<need){
      const t = titles[i++];
      try{
        const cats = await titleCats(t);
        if(allowedByWhitelist(genre, cats)) allowed.push(t);
      }catch{}
    }
  }
  const workers = Array.from({length:limit}, worker);
  await Promise.all(workers);
  return allowed.slice(0, need);
}

async function titlesForGenre(genre, seed, need=80){
  const roots = GENRE_WHITELIST[genre] || [];
  if(!roots.length) return [];
  const start = Number(seed & 0xffffffffn) % roots.length;
  const order = roots.slice(start).concat(roots.slice(0,start));

  let acc=[];
  for(const root of order){
    const cur = (cursorMap[root]||"");
    const {titles, cont} = await catMembers(root, cur);
    cursorMap[root]=cont||""; saveJ(CURSOR_KEY, cursorMap);
    const notSeen = titles.filter(t=>!seenTitles.has(t) && recentTitles.indexOf(t)===-1);
    const ok = await filterAllowedParallel(genre, notSeen, need-acc.length, 25);
    acc.push(...ok);
    if(acc.length>=need) break;
  }
  shuffle(acc, seed^0x9abcdn);
  return acc;
}

async function rndTitles(n=60){
  const d=await jget('https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit='+n+'&origin=*');
  return ((d.query&&d.query.random)||[]).map(x=>x.title);
}
async function sumByTitle(t){ return norm(await jget('https://ja.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(t))); }

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
  let tries=0;
  while(candidates.length===0 && tries<3){
    tries++;
    const mix = await rndTitles(60);
    shuffle(mix, seed + BigInt(tries));
    candidates = mix.filter(t=>!seenTitles.has(t) && recentTitles.indexOf(t)===-1);
  }
  if(!candidates.length) return null;

  for(const t of candidates){
    try{
      const s = await sumByTitle(t);
      const cb = canonicalBlurb(s.blurb);
      if(cb.length < 6) continue;
      if(seenBlurbs.has(cb)) continue;
      if(g!=='all'){
        try{
          const cats = await titleCats(s.title);
          if(!allowedByWhitelist(g, cats)) continue;
        }catch{ continue; }
      }
      return s;
    }catch{}
  }
  return null;
}

// NEXTの読み込み状態制御＋7秒ガード
let loading=false, guardId=null;
async function showOneWithGuard(){
  if(loading) return;
  loading=true;
  nextBtn.disabled=true;
  const prevTitle=titleBox.textContent;
  titleBox.textContent="（読み込み中…）"; blurbBox.textContent="";
  guardId=setTimeout(async ()=>{
    // ガード発火: フォールバックでランダム提示
    try{
      const r = await rndTitles(40);
      for(const t of r){
        if(seenTitles.has(t)) continue;
        const s = await sumByTitle(t);
        const cb = canonicalBlurb(s.blurb);
        if(cb.length>=6 && !seenBlurbs.has(cb)){ current=s; break; }
      }
      if(current){ renderAndMark(current); }
      else { titleBox.textContent=prevTitle; blurbBox.textContent="（タイムアウト。再度お試しください）"; }
    }catch{
      titleBox.textContent=prevTitle; blurbBox.textContent="（タイムアウト。再度お試しください）";
    }finally{
      loading=false; nextBtn.disabled=false;
    }
  }, 7000);

  try{
    const s = await pickNew();
    if(s){
      clearTimeout(guardId); guardId=null;
      renderAndMark(s);
    }else{
      titleBox.textContent="（候補が見つかりません）";
      blurbBox.textContent="ジャンルを変えるか、少し時間をおいて再試行してください。";
    }
  }finally{
    loading=false; nextBtn.disabled=false;
    if(guardId){ clearTimeout(guardId); guardId=null; }
  }
}

function renderAndMark(s){
  current=s;
  const cb = canonicalBlurb(s.blurb);
  seenTitles.add(s.title); saveJ(SEEN_TITLES, Array.from(seenTitles).slice(-100000));
  seenBlurbs.add(cb);      saveJ(SEEN_BLURBS, Array.from(seenBlurbs).slice(-100000));
  recentTitles = (recentTitles.concat([s.title])).slice(-40); saveJ(RECENT_TITLES, recentTitles);
  renderMain(s);
}

// events
document.addEventListener('DOMContentLoaded', () => {
  nextBtn.addEventListener('click',showOneWithGuard);
  backBtn.addEventListener('click',showMain);
  clearBtn.addEventListener('click',()=>{ if(!altview.hidden) showMain(); });
  detailBtn.addEventListener('click',()=>{ if(!current) return;
    showAlt(`<h3>DETAIL</h3>${esc(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`);
  });
  relatedBtn.addEventListener('click', async()=>{
    if(!current) return;
    showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
    try{
      const rel=await (async()=>{
        // 簡易版: related APIのみ（速度優先）。必要なら多段フォールバックを戻せます。
        const d=await jget('https://ja.wikipedia.org/api/rest_v1/page/related/'+encodeURIComponent(current.title));
        return (d.pages||[]).map(norm);
      })();
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

  setTimeout(showOneWithGuard, 300);
  if(location.protocol.startsWith('http')&&'serviceWorker'in navigator){
    navigator.serviceWorker.register('./serviceWorker.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{});
  }
});
})();