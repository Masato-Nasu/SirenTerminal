'use strict';
// v22.6.0 — Related-only mode + RESET
(() => {
  if (window.__siren_lock_v2260R) return; window.__siren_lock_v2260R = true;

  const CFG = Object.assign({
    TIMEOUT_MS: 6000,
    PRELOAD_REL_MAX: 6,   // 関連だけなので少し多め
    LRU_MAX: 120,
    BLURB_MAX: 900
  }, window.__SIREN_CFG || {});

  // Anti double-load（一掃）
  const keep = /script\.v2260-related\.js/i;
  [...document.scripts].forEach(s => { if (/\/script(\.v\d+)?\.js(\?.*)?$/i.test(s.src) && !keep.test(s.src)) s.remove(); });

  // DOM
  const $=id=>document.getElementById(id);
  const titleEl=$('title'), blurbEl=$('blurb'), statusEl=$('status');
  const nextBtn=$('nextBtn'), detailBtn=$('detailBtn'), openBtn=$('openBtn'), backBtn=$('backBtn'), resetBtn=$('resetBtn');
  const maintext=$('maintext'), altview=$('altview');
  const prefInput=$('prefInput'), applyBtn=$('applyBtn');

  const setStatus=t=>{ statusEl && (statusEl.textContent=t||''); };
  const showMain=()=>{ maintext?.classList.remove('hidden'); altview?.classList.add('hidden'); backBtn?.classList.add('hidden'); };
  const showAlt =html=>{ if (altview){ altview.textContent=''; altview.insertAdjacentHTML('afterbegin', html); altview.classList.remove('hidden'); } maintext?.classList.add('hidden'); backBtn?.classList.remove('hidden'); };
  const setBtns=on=>[nextBtn,detailBtn,openBtn,backBtn,applyBtn,resetBtn].forEach(b=>b && (b.disabled=!on));

  // JSONP
  function jsonp(url, ms=CFG.TIMEOUT_MS){
    return new Promise((resolve, reject)=>{
      let finished=false;
      const cb='__jp_'+Math.random().toString(36).slice(2);
      const s=document.createElement('script');
      const to=setTimeout(()=>{ if(finished) return; finished=true; cleanup(); reject(new Error('timeout')); }, ms);
      function cleanup(){ clearTimeout(to); try{ delete window[cb]; }catch(_){ window[cb]=undefined; } s.remove(); }
      window[cb]=d=>{ if(finished) return; finished=true; cleanup(); resolve(d); };
      s.src = url + (url.includes('?')?'&':'?') + 'callback=' + cb + '&_t=' + Date.now();
      s.onerror = e => { if(finished) return; finished=true; cleanup(); reject(e); };
      document.head.appendChild(s);
    });
  }

  // Wikipedia helpers
  const sumCache = new Map();
  async function getSummary(t){
    if (sumCache.has(t)) return sumCache.get(t);
    const u='https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles='+encodeURIComponent(t);
    const j=await jsonp(u); const ps=j?.query?.pages?Object.values(j.query.pages):[];
    if(!ps.length) throw new Error('no page'); const p=ps[0]; if(!p.extract) throw new Error('no extract');
    const val={title:p.title||t, detail:(p.extract||'').trim(), url:'https://ja.wikipedia.org/wiki/'+encodeURIComponent(p.title||t)};
    sumCache.set(t,val); return val;
  }
  async function searchTitles(q, n=12){
    const cleaned=String(q||'').replace(/[()（）：:]/g,' ').split(/\s+/).slice(0,6).join(' ');
    const u='https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch='+encodeURIComponent(cleaned)+'&srlimit='+n+'&format=json';
    const j=await jsonp(u); return (j?.query?.search||[]).map(o=>o.title);
  }
  async function randomTitle(){
    const j=await jsonp('https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json');
    return j?.query?.random?.[0]?.title||'';
  }

  // LRU dedup
  const LRU_KEY='siren_seen_titles_v2260R';
  const loadSeen=()=>{ try{ const a=JSON.parse(localStorage.getItem(LRU_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } };
  const saveSeen=a=>{ try{ localStorage.setItem(LRU_KEY, JSON.stringify(a)); }catch(_){} };
  let seen=loadSeen(); const seenSet=new Set(seen);
  function markSeen(t){ t=String(t||''); if(!t) return; if(seenSet.has(t)) return; seen.push(t); while(seen.length>CFG.LRU_MAX) seen.shift(); saveSeen(seen); seenSet.add(t); }
  const isDup=t=>!t || seenSet.has(String(t));

  // Related queue behavior
  const relQueue=[];
  async function refillFromSeed(seed){
    const out=[]; const titles=await searchTitles(seed, CFG.PRELOAD_REL_MAX*2);
    for(const tt of titles){
      if(isDup(tt)) continue;
      try{ const s=await getSummary(tt); if(!s.detail || isDup(s.title)) continue; out.push(s); if(out.length>=CFG.PRELOAD_REL_MAX) break; }catch{}
    }
    if(out.length){ relQueue.length=0; out.forEach(x=>relQueue.push(x)); }
  }

  // Seed management
  function getSeed(){
    const last=(localStorage.getItem('siren_last_query')||'').trim();
    if(last) return last;
    return current?.title||'';
  }
  function setSeed(q){ try{ localStorage.setItem('siren_last_query', q||''); }catch{} }

  // Render
  let current=null, renderToken=0, loading=false;
  function render(item, token){
    if(token!==renderToken) return;
    current=item; markSeen(item.title);
    const t=`【 ${item.title} 】`; if(titleEl && titleEl.textContent!==t) titleEl.textContent=t;
    const text=(item.detail||'').slice(0, CFG.BLURB_MAX) || '（説明なし）';
    if(blurbEl && blurbEl.textContent!==text) blurbEl.textContent=text;
    setStatus(''); showMain(); setBtns(true); loading=false;
  }

  async function showNextRelated(){
    if(loading) return; loading=true; setBtns(false);
    const token=++renderToken;
    try{
      if(relQueue.length){ return render(relQueue.shift(), token); }
      setStatus('読み込み中…');
      const seed=getSeed();
      if(seed){ await refillFromSeed(seed); if(relQueue.length) return render(relQueue.shift(), token); }
      // seed がない場合だけ 1 回ランダムで種を作る
      const first = await randomTitle(); const s=await getSummary(first);
      render(s, token); setSeed(s.title);
      setTimeout(()=>{ refillFromSeed(s.title).catch(()=>{}); }, 200);
    }catch(e){
      console.error(e); if (titleEl) titleEl.textContent='（取得エラー）'; if (blurbEl) blurbEl.textContent='NEXTで再試行してください。'; setStatus(''); setBtns(true); loading=false;
    }
  }

  // Input & Reset
  function applyQuery(){
    const q=(prefInput?.value||'').trim();
    if(!q){ showNextRelated(); return; }
    setSeed(q); // 以後は関連のみで継続
    // まずその語から即1件
    (async()=>{
      const token=++renderToken;
      try{
        setStatus('読み込み中…'); setBtns(false);
        let s=null; const titles=await searchTitles(q, 8);
        for(const tt of titles){ if(isDup(tt)) continue;
          try{ s=await getSummary(tt); if(s && s.detail) break; }catch{}
        }
        if(s){ render(s, token); }
        setTimeout(()=>{ refillFromSeed(q).catch(()=>{}); }, 200);
      }catch(e){ console.error(e); setStatus(''); setBtns(true); }
    })();
  }

  async function doReset(){
    try{
      localStorage.removeItem('siren_last_query');
      localStorage.removeItem(LRU_KEY);
      seen=[]; seenSet.clear(); relQueue.length=0;
      current=null; renderToken++; // cancel in-flight
      setStatus('リセットしました。'); setTimeout(()=>{ setStatus(''); }, 800);
      showNextRelated(); // 1回だけランダムで新しい種を作る
    }catch(e){ console.error(e); }
  }

  // Bind
  nextBtn?.addEventListener('click', showNextRelated, {passive:true});
  detailBtn?.addEventListener('click', ()=>{ if(!current) return; showAlt(`<h3>${current.title}</h3>\n${current.detail}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`); }, {passive:true});
  openBtn?.addEventListener('click', ()=>{ if(!current) return; window.open(current.url,'_blank','noopener'); }, {passive:true});
  resetBtn?.addEventListener('click', doReset, {passive:true});
  $('backBtn')?.addEventListener('click', ()=>{ if (altview){ altview.classList.add('hidden'); altview.textContent=''; } if (maintext) maintext.classList.remove('hidden'); $('backBtn').classList.add('hidden'); }, {passive:true});
  applyBtn?.addEventListener('click', applyQuery);
  prefInput?.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); applyQuery(); } });

  // Boot
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(showNextRelated, 0);
  } else {
    document.addEventListener('DOMContentLoaded', showNextRelated, {once:true});
  }

  // SW（fetch無し最小）
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./serviceWorker.js'); } catch{}
  }
})();