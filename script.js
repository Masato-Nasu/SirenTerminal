// v20.5: prefetch queue + single init + tokenized render + fast genre
(function(){
const $=s=>document.querySelector(s);
const titleBox=$("#title"),blurbBox=$("#blurb"),genreSel=$("#genreSel");
const detailBtn=$("#detailBtn"),relatedBtn=$("#relatedBtn"),openBtn=$("#openBtn"),
      nextBtn=$("#nextBtn"),backBtn=$("#backBtn"),clearBtn=$("#clearBtn"),
      maintext=$("#maintext"),altview=$("#altview");
let current=null;const V='v20_5';

// init guard
if(window.__siren_inited__) return; window.__siren_inited__ = true;

// storage keys
const SEEN_TITLES='seen_titles_'+V, SEEN_BLURBS='seen_blurbs_'+V, DAY_KEY='seen_day_'+V;
const CURSOR_KEY='cat_cursor_'+V, RECENT_TITLES='recent_titles_'+V;

// state
let seenTitles=new Set(loadJ(SEEN_TITLES,[]));
let seenBlurbs=new Set(loadJ(SEEN_BLURBS,[]));
let recentTitles=loadJ(RECENT_TITLES,[]);
let cursorMap=loadJ(CURSOR_KEY,{});
let queue=[]; // prefetch summaries
let inFlightToken=0; // to avoid double render
let filling=false;

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

// daily reset
(function dailyReset(){
  const now=today();
  const last=localStorage.getItem(DAY_KEY);
  if(last!==now){
    saveJ(SEEN_TITLES, loadJ(SEEN_TITLES, []).slice(-5000));
    saveJ(SEEN_BLURBS, loadJ(SEEN_BLURBS, []).slice(-5000));
    localStorage.setItem(DAY_KEY, now);
  }
})();

// helpers
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function loadJ(k,f){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(f))}catch{return f}}
function saveJ(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}
function bust(u){return u+(u.includes('?')?'&':'?')+'t='+Date.now()}
async function jget(u, timeoutMs=5000){
  const controller=new AbortController();
  const id=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const res=await fetch(bust(u),{mode:'cors',headers:{'Accept':'application/json'},cache:'no-store',signal:controller.signal});
    if(!res.ok) throw new Error('HTTP '+res.status);
    const ct=res.headers.get('content-type')||'';
    if(!ct.includes('application/json')) throw new Error('Non-JSON');
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
function canonicalBlurb(s){return s.replace(/\s+/g,'').replace(/[「」『』（）()［］\[\]、。・,\.]/g,'').toLowerCase();}

// wiki fetchers
async function catMembers(cat, cont=""){
  const u='https://ja.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle='+encodeURIComponent(cat)+'&cmtype=page&cmnamespace=0&cmlimit=100&origin=*'+(cont?('&cmcontinue='+encodeURIComponent(cont)):'');
  const d=await jget(u);
  const m=(d.query&&d.query.categorymembers)||[];
  const next=(d.continue&&d.continue.cmcontinue)||"";
  return {titles:m.map(x=>x.title), cont: next};
}
async function sumByTitle(t){
  const d=await jget('https://ja.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(t));
  return norm(d);
}
async function relatedOf(title){
  try{
    const d=await jget('https://ja.wikipedia.org/api/rest_v1/page/related/'+encodeURIComponent(title));
    return (d.pages||[]).map(norm);
  }catch{ return []; }
}

// prefetch queue (fill up to 12)
async function fillQueue(genre){
  if(filling) return; filling=true;
  const target=12;
  try{
    if(queue.length>=target) return;
    let titles=[];
    if(genre==='all'){
      // use Wikipedia random (once) — summaries will filter duplicates
      const d=await jget('https://ja.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=80&origin=*');
      titles=((d.query&&d.query.random)||[]).map(x=>x.title);
    }else{
      const roots=GENRE_WHITELIST[genre]||[];
      if(!roots.length){ filling=false; return; }
      // round-robin roots
      for(let r=0;r<roots.length && titles.length<80;r++){
        const root=roots[r];
        const cur=(cursorMap[root]||"");
        const {titles:ts, cont}=await catMembers(root, cur);
        cursorMap[root]=cont||""; saveJ(CURSOR_KEY, cursorMap);
        titles.push(...ts);
      }
    }
    // filter seen + recent first
    titles=titles.filter(t=>!seenTitles.has(t) && recentTitles.indexOf(t)===-1);
    // fetch summaries in parallel (limit 4)
    let i=0; const out=[]; const limit=4;
    async function worker(){
      while(i<titles.length && queue.length+out.length<target){
        const t=titles[i++];
        try{
          const s=await sumByTitle(t);
          const cb=canonicalBlurb(s.blurb);
          if(cb.length>=6 && !seenBlurbs.has(cb)){
            out.push(s);
          }
        }catch{}
      }
    }
    const workers=Array.from({length:limit}, worker);
    await Promise.all(workers);
    queue.push(...out);
  }finally{
    filling=false;
  }
}

// core show
function showMain(){ maintext.hidden=false; altview.hidden=true; backBtn.hidden=true; }
function showAlt(h){ altview.innerHTML=h; maintext.hidden=true; altview.hidden=false; backBtn.hidden=false; }
function render(s, token){
  if(token!==inFlightToken) return; // outdated render
  titleBox.textContent=`【 ${s.title} 】`;
  blurbBox.textContent=s.blurb;
  showMain();
}
function markSeen(s){
  const cb=canonicalBlurb(s.blurb);
  seenTitles.add(s.title); saveJ(SEEN_TITLES, Array.from(seenTitles).slice(-100000));
  seenBlurbs.add(cb);      saveJ(SEEN_BLURBS, Array.from(seenBlurbs).slice(-100000));
  recentTitles=(recentTitles.concat([s.title])).slice(-40); saveJ(RECENT_TITLES, recentTitles);
}

async function nextConcept(){
  // tokenize
  inFlightToken++; const token=inFlightToken;
  nextBtn.disabled=true; titleBox.textContent="（読み込み中…）"; blurbBox.textContent="";
  const genre=genreSel.value;
  try{
    if(queue.length===0) await fillQueue(genre);
    const s = queue.shift();
    if(!s){
      titleBox.textContent="（候補が見つかりません）";
      blurbBox.textContent="ジャンルを変えるか、少し時間をおいて再試行してください。";
      return;
    }
    current=s; markSeen(s); render(s, token);
    // background prefetch
    fillQueue(genre);
  }finally{
    if(token===inFlightToken) nextBtn.disabled=false;
  }
}

// events (single init)
document.addEventListener('DOMContentLoaded', async () => {
  nextBtn.addEventListener('click', nextConcept);
  backBtn.addEventListener('click', showMain);
  clearBtn.addEventListener('click', ()=>{ if(!altview.hidden) showMain(); });
  detailBtn.addEventListener('click', ()=>{ if(!current) return;
    showAlt(`<h3>DETAIL</h3>${esc(current.detail)}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`);
  });
  relatedBtn.addEventListener('click', async ()=>{
    if(!current) return;
    showAlt("<h3>RELATED</h3><ul><li>loading…</li></ul>");
    try{
      const rel=await relatedOf(current.title);
      if(!rel.length){ showAlt("<h3>RELATED</h3><ul><li>(no items)</li></ul>"); return; }
      const items=rel.slice(0,9).map((p,i)=>`<li>[${i+1}] <a href="${p.url}" target="_blank" rel="noopener">${esc(p.title)}</a></li>`).join("");
      showAlt(`<h3>RELATED</h3><ul>${items}</ul>`);
    }catch{
      showAlt("<h3>RELATED</h3><ul><li>(failed)</li></ul>");
    }
  });

  // first fill & show
  await fillQueue(genreSel.value);
  await nextConcept();

  if(location.protocol.startsWith('http')&&'serviceWorker'in navigator){
    navigator.serviceWorker.register('./serviceWorker.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{});
  }
});
})();