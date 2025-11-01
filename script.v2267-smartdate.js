
"use strict";
(()=>{
  if(window.__siren_lock_v2267)return;window.__siren_lock_v2267=true;
  const CFG=Object.assign({TIMEOUT_MS:4500,BLURB_MAX:480,LRU_MAX:200,NEXT_COOLDOWN:400,FILTER_DATES:true,ALLOW_LIST:[]},window.__SIREN_CFG||{});
  const keep=/script\.v2267-smartdate\.js/i;[...document.scripts].forEach(s=>{/\/script(\.v\d+)?\.js(\?.*)?$/i.test(s.src)&&!keep.test(s.src)&&s.remove()});
  const $=id=>document.getElementById(id);
  const titleEl=$("title"),blurbEl=$("blurb"),statusEl=$("status");
  const nextRandomBtn=$("nextRandomBtn"),nextRelatedBtn=$("nextRelatedBtn"),detailBtn=$("detailBtn"),openBtn=$("openBtn"),backBtn=$("backBtn");
  const maintext=$("maintext"),altview=$("altview"),prefInput=$("prefInput"),applyBtn=$("applyBtn");
  const setStatus=t=>{statusEl&&(statusEl.textContent=t||"")};const showMain=()=>{maintext?.classList.remove("hidden");altview?.classList.add("hidden");backBtn?.classList.add("hidden")};
  const showAlt=html=>{if(altview){altview.textContent="";altview.insertAdjacentHTML("afterbegin",html);altview.classList.remove("hidden")}maintext?.classList.add("hidden");backBtn?.classList.remove("hidden")};
  const setBtns=on=>[nextRandomBtn,nextRelatedBtn,detailBtn,openBtn,backBtn,applyBtn].forEach(b=>b&&(b.disabled=!on));
  const allowSet=new Set([...(CFG.ALLOW_LIST||[])]);
  function isNoisyTitle(t){if(!CFG.FILTER_DATES)return false;if(!t)return true;if(allowSet.has(t))return false;
    if(/^(Wikipedia|ウィキペディア|Help|ヘルプ|Portal|ポータル|Template|テンプレート|Category|カテゴリ|ファイル):/i.test(t))return true;
    if(/^\d{3,4}$/.test(t))return true;if(/^\d{3,4}年代$/.test(t))return true;if(/^\d{1,2}月\d{1,2}日$/.test(t))return true;
    if(/^\d{3,4}年(\d{1,2}月(\d{1,2}日)?)?$/.test(t))return true;if(/^(令和|平成|昭和)\d+年$/.test(t))return true;if(/紀元前\d+年/.test(t))return true;
    if(/(一覧|年表|年譜|のリスト|リスト|作品一覧|人物一覧)$/.test(t))return true;if(/(今日は何の日|記念日|出来事|誕生日|死亡|没)$/.test(t))return true;return false}
  const goodTitle=t=>!!t&&!isNoisyTitle(String(t));
  function jsonp(url,ms=CFG.TIMEOUT_MS){return new Promise((res,rej)=>{let done=false;const cb="__jp_"+Math.random().toString(36).slice(2);
    const s=document.createElement("script");const to=setTimeout(()=>{if(done)return;done=true;cleanup();rej(new Error("timeout"))},ms);
    function cleanup(){clearTimeout(to);try{delete window[cb]}catch(_){window[cb]=undefined}s.remove()}
    window[cb]=d=>{if(done)return;done=true;cleanup();res(d)};s.src=url+(url.includes("?")?"&":"?")+"callback="+cb+"&_t="+Date.now();
    s.onerror=e=>{if(done)return;done=true;cleanup();rej(e)};document.head.appendChild(s)})}
  const sumCache=new Map();
  async function getSummary(t){if(sumCache.has(t))return sumCache.get(t);
    const u="https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles="+encodeURIComponent(t);
    const j=await jsonp(u);const ps=j?.query?.pages?Object.values(j.query.pages):[];if(!ps.length)throw new Error("no page");const p=ps[0];if(!p.extract)throw new Error("no extract");
    const val={title:p.title||t,detail:(p.extract||"").trim(),url:"https://ja.wikipedia.org/wiki/"+encodeURIComponent(p.title||t)};sumCache.set(t,val);return val}
  async function randomTitle(maxTry=6){for(let i=0;i<maxTry;i++){const j=await jsonp("https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json");const t=j?.query?.random?.[0]?.title||"";if(goodTitle(t))return t}
    const j=await jsonp("https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json");return j?.query?.random?.[0]?.title||""}
  async function prefixTitles(q){const u="https://ja.wikipedia.org/w/api.php?action=opensearch&search="+encodeURIComponent(q||"")+"&limit=15&namespace=0&format=json";
    const j=await jsonp(u);let arr=(Array.isArray(j)&&Array.isArray(j[1]))?j[1]:[];return CFG.FILTER_DATES?arr.filter(goodTitle):arr}
  async function pageLinks(title,plc){let u="https://ja.wikipedia.org/w/api.php?action=query&prop=links&plnamespace=0&pllimit=20&format=json&titles="+encodeURIComponent(title||"");if(plc)u+="&plcontinue="+encodeURIComponent(plc);
    const j=await jsonp(u);const ps=j?.query?.pages?Object.values(j.query.pages):[];let links=(ps[0]?.links||[]).map(o=>o.title);if(CFG.FILTER_DATES)links=links.filter(goodTitle);const cont=j?.continue?.plcontinue||null;return {links,cont}}
  async function searchTitlesPaged(q,off){const u="https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch="+encodeURIComponent(q||"")+"&sroffset="+(off||0)+"&srlimit=10&format=json";
    const j=await jsonp(u);let arr=(j?.query?.search||[]).map(o=>o.title);if(CFG.FILTER_DATES)arr=arr.filter(goodTitle);const next=(j?.continue?.sroffset!=null)?j.continue.sroffset:null;return {titles:arr,nextOffset:next}}
  const LRU_KEY="siren_seen_titles_v2267";const loadSeen=()=>{try{return JSON.parse(localStorage.getItem(LRU_KEY)||"[]")||[]}catch(_){return[]}};
  const saveSeen=a=>{try{localStorage.setItem(LRU_KEY,JSON.stringify(a))}catch(_){}};let seen=loadSeen();const seenSet=new Set(seen);
  function markSeen(t){t=String(t||"");if(!t)return;if(seenSet.has(t))return;seen.push(t);while(seen.length>CFG.LRU_MAX)seen.shift();saveSeen(seen);seenSet.add(t)}
  const isDup=t=>!t||seenSet.has(String(t));
  function stateKey(seed){return"siren_stream_state_"+encodeURIComponent(seed||"")}
  function loadState(seed){try{return Object.assign({prefixIdx:0,searchOffset:0,plcontinue:null},JSON.parse(localStorage.getItem(stateKey(seed))||"{}"))}catch(_){return{prefixIdx:0,searchOffset:0,plcontinue:null}}}
  function saveState(seed,st){try{localStorage.setItem(stateKey(seed),JSON.stringify(st))}catch(_){}}
  function clearSeedState(seed){try{localStorage.removeItem(stateKey(seed))}catch(_){}}
  function sanitizeSeed(q){return(CFG.FILTER_DATES&&isNoisyTitle(q))?"":(q||"")}
  function getSeed(){const last=(localStorage.getItem("siren_last_query")||"").trim();return sanitizeSeed(last)||current?.title||""}
  function setSeed(q){try{localStorage.setItem("siren_last_query",sanitizeSeed(q)||"")}catch{}}
  let current=null,renderToken=0,loading=false,lastAct=0;
  function render(item,token){if(token!==renderToken)return;current=item;markSeen(item.title);const t=`【 ${item.title} 】`;if(titleEl&&titleEl.textContent!==t)titleEl.textContent=t;const text=(item.detail||"").slice(0,CFG.BLURB_MAX)||"（説明なし）";if(blurbEl&&blurbEl.textContent!==text)blurbEl.textContent=text;setStatus("");showMain();setBtns(true);loading=false}
  function cooldown(){const now=Date.now();if(now-lastAct<CFG.NEXT_COOLDOWN)return false;lastAct=now;return true}
  async function nextRelatedOne(seed,cur){const st=loadState(seed);
    if(cur){try{const {links,cont}=await pageLinks(cur,st.plcontinue);st.plcontinue=cont;saveState(seed,st);for(const tt of links){if(isDup(tt))continue;try{const s=await getSummary(tt);if(s&&s.detail&&!isDup(s.title))return s}catch{}}}catch{}}
    try{const arr=await prefixTitles(seed);if(arr.length){for(let i=0;i<arr.length;i++){const idx=(st.prefixIdx+i)%arr.length;const tt=arr[idx];if(isDup(tt))continue;try{const s=await getSummary(tt);if(s&&s.detail&&!isDup(s.title)){st.prefixIdx=idx+1;saveState(seed,st);return s}}catch{}}st.prefixIdx=(st.prefixIdx+1)%arr.length;saveState(seed,st)}}catch{}
    try{let guard=0;while(guard++<6){const {titles,nextOffset}=await searchTitlesPaged(seed,st.searchOffset||0);st.searchOffset=nextOffset||0;saveState(seed,st);for(const tt of titles){if(isDup(tt))continue;try{const s=await getSummary(tt);if(s&&s.detail&&!isDup(s.title))return s}catch{}}if(nextOffset==null)break}}catch{}return null}
  async function showNextRelated(){if(!cooldown()||loading)return;loading=true;setBtns(false);const token=++renderToken;try{setStatus("関連を探索中…");const seed=getSeed();let s=null;if(seed){s=await nextRelatedOne(seed,current?.title)}if(!s){const t=await randomTitle(6);s=await getSummary(t);setSeed(s.title);clearSeedState(s.title)}render(s,token)}catch(e){console.error(e);if(titleEl)titleEl.textContent="（取得エラー）";if(blurbEl)blurbEl.textContent="NEXTで再試行してください。";setStatus("");setBtns(true);loading=false}}
  async function showNextRandom(){if(!cooldown()||loading)return;loading=true;setBtns(false);const token=++renderToken;try{setStatus("ランダム取得中…");const t=await randomTitle(6);const s=await getSummary(t);render(s,token);setSeed(s.title);clearSeedState(s.title)}catch(e){console.error(e);if(titleEl)titleEl.textContent="（取得エラー）";if(blurbEl)blurbEl.textContent="NEXTで再試行してください。";setStatus("");setBtns(true);loading=false}}
  function applyQuery(){const q=(prefInput?.value||"").trim();if(!q){showNextRelated();return}setSeed(q);clearSeedState(q);(async()=>{const token=++renderToken;try{setStatus("読み込み中…");setBtns(false);let s=null;try{const {titles}=await searchTitlesPaged(q,0);for(const tt of titles){if(isDup(tt))continue;try{s=await getSummary(tt);if(s&&s.detail)break}catch{}}}catch{}if(!s){const t=await randomTitle(6);s=await getSummary(t)}render(s,token)}catch(e){console.error(e);setStatus("");setBtns(true)}})()}
  nextRandomBtn?.addEventListener("click",showNextRandom,{passive:true});
  nextRelatedBtn?.addEventListener("click",showNextRelated,{passive:true});
  detailBtn?.addEventListener("click",()=>{if(!current)return;showAlt(`<h3>${current.title}</h3>\n${current.detail}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`);},{passive:true});
  openBtn?.addEventListener("click",()=>{if(!current)return;window.open(current.url,"_blank","noopener")},{passive:true});
  $("backBtn")?.addEventListener("click",()=>{if(altview){altview.classList.add("hidden");altview.textContent=""}if(maintext)maintext.classList.remove("hidden");$("backBtn").classList.add("hidden")},{passive:true});
  applyBtn?.addEventListener("click",applyQuery);prefInput?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();applyQuery()}});
  if(document.readyState==="complete"||document.readyState==="interactive"){setTimeout(showNextRelated,0)}else{document.addEventListener("DOMContentLoaded",showNextRelated,{once:true})}
  if(location.protocol.startsWith("http")&&"serviceWorker"in navigator){try{navigator.serviceWorker.register("./serviceWorker.js")}catch{}}
})();
