'use strict';
// v22.6.4 Dual NEXT / Stream Related
// - 「関連」は毎回 1 件だけ導出（ストリーミング）。固定上限は設けない。
// - ソース優先度：Links → Prefix(opensearch) → Search（必要になった時だけ呼ぶ）
// - seed ごとのオフセット/トークンを localStorage に保存して “少しずつズレる” 連鎖を実現
(() => {
  if (window.__siren_lock_v2264DS) return; window.__siren_lock_v2264DS = true;

  const CFG = Object.assign({
    TIMEOUT_MS: 4500,
    BLURB_MAX: 480,
    LRU_MAX: 200,
    NEXT_COOLDOWN: 400
  }, window.__SIREN_CFG || {});

  const keep = /script\.v2264-dualnext-stream\.js/i;
  [...document.scripts].forEach(s => { if (/\/script(\.v\d+)?\.js(\?.*)?$/i.test(s.src) && !keep.test(s.src)) s.remove(); });

  // DOM
  const $=id=>document.getElementById(id);
  const titleEl=$('title'), blurbEl=$('blurb'), statusEl=$('status');
  const nextRandomBtn=$('nextRandomBtn'), nextRelatedBtn=$('nextRelatedBtn');
  const detailBtn=$('detailBtn'), openBtn=$('openBtn'), backBtn=$('backBtn');
  const maintext=$('maintext'), altview=$('altview');
  const prefInput=$('prefInput'), applyBtn=$('applyBtn');

  const setStatus=t=>{ statusEl && (statusEl.textContent=t||''); };
  const showMain=()=>{ maintext?.classList.remove('hidden'); altview?.classList.add('hidden'); backBtn?.classList.add('hidden'); };
  const showAlt =html=>{ if (altview){ altview.textContent=''; altview.insertAdjacentHTML('afterbegin', html); altview.classList.remove('hidden'); } maintext?.classList.add('hidden'); backBtn?.classList.remove('hidden'); };
  const setBtns=on=>[nextRandomBtn,nextRelatedBtn,detailBtn,openBtn,backBtn,applyBtn].forEach(b=>b && (b.disabled=!on));

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

  // Wiki helpers
  const sumCache = new Map();
  async function getSummary(t){
    if (sumCache.has(t)) return sumCache.get(t);
    const u='https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles='+encodeURIComponent(t);
    const j=await jsonp(u); const ps=j?.query?.pages?Object.values(j.query.pages):[];
    if(!ps.length) throw new Error('no page'); const p=ps[0]; if(!p.extract) throw new Error('no extract');
    const val={title:p.title||t, detail:(p.extract||'').trim(), url:'https://ja.wikipedia.org/wiki/'+encodeURIComponent(p.title||t)};
    sumCache.set(t,val); return val;
  }
  async function randomTitle(){
    const j=await jsonp('https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json');
    return j?.query?.random?.[0]?.title||'';
  }
  async function prefixTitles(q){
    const u='https://ja.wikipedia.org/w/api.php?action=opensearch&search='+encodeURIComponent(q||'')+'&limit=15&namespace=0&format=json';
    const j=await jsonp(u);
    return (Array.isArray(j) && Array.isArray(j[1])) ? j[1] : [];
  }
  async function pageLinks(title, plcontinue){
    let u='https://ja.wikipedia.org/w/api.php?action=query&prop=links&plnamespace=0&pllimit=20&format=json&titles='+encodeURIComponent(title||'');
    if (plcontinue) u += '&plcontinue='+encodeURIComponent(plcontinue);
    const j=await jsonp(u);
    const ps=j?.query?.pages?Object.values(j.query.pages):[];
    const links = (ps[0]?.links||[]).map(o=>o.title);
    const cont = j?.continue?.plcontinue || null;
    return {links, cont};
  }
  async function searchTitlesPaged(q, offset){
    const u='https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch='+encodeURIComponent(q||'')+'&sroffset='+(offset||0)+'&srlimit=10&format=json';
    const j=await jsonp(u);
    const arr=(j?.query?.search||[]).map(o=>o.title);
    const nextOffset = (j?.continue?.sroffset != null) ? j.continue.sroffset : null;
    return {titles:arr, nextOffset};
  }

  // LRU
  const LRU_KEY='siren_seen_titles_v2264DS';
  const loadSeen=()=>{ try{ const a=JSON.parse(localStorage.getItem(LRU_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } };
  const saveSeen=a=>{ try{ localStorage.setItem(LRU_KEY, JSON.stringify(a)); }catch(_){} };
  let seen=loadSeen(); const seenSet=new Set(seen);
  function markSeen(t){ t=String(t||''); if(!t) return; if(seenSet.has(t)) return; seen.push(t); while(seen.length>CFG.LRU_MAX) seen.shift(); saveSeen(seen); seenSet.add(t); }
  const isDup=t=>!t || seenSet.has(String(t));

  // Stream state per seed
  function stateKey(seed){ return 'siren_stream_state_'+encodeURIComponent(seed||''); }
  function loadState(seed){
    try{
      const obj=JSON.parse(localStorage.getItem(stateKey(seed))||'{}');
      return Object.assign({prefixIdx:0, searchOffset:0, plcontinue:null}, obj);
    }catch(_){ return {prefixIdx:0, searchOffset:0, plcontinue:null}; }
  }
  function saveState(seed, st){
    try{ localStorage.setItem(stateKey(seed), JSON.stringify(st)); }catch(_){}
  }

  // Seed
  function getSeed(){ const last=(localStorage.getItem('siren_last_query')||'').trim(); return last || current?.title || ''; }
  function setSeed(q){ try{ localStorage.setItem('siren_last_query', q||''); }catch{} }
  function clearSeedState(seed){ try{ localStorage.removeItem(stateKey(seed)); }catch(_){} }

  // Render
  let current=null, renderToken=0, loading=false, lastAct=0;
  function render(item, token){
    if (token!==renderToken) return;
    current=item; markSeen(item.title);
    const t=`【 ${item.title} 】`; if(titleEl && titleEl.textContent!==t) titleEl.textContent=t;
    const text=(item.detail||'').slice(0, CFG.BLURB_MAX) || '（説明なし）';
    if(blurbEl && blurbEl.textContent!==text) blurbEl.textContent=text;
    setStatus(''); showMain(); setBtns(true); loading=false;
  }
  function cooldown(){ const now=Date.now(); if (now-lastAct<CFG.NEXT_COOLDOWN) return false; lastAct=now; return true; }

  async function nextRelatedOne(seed, curTitle){
    // 都度 1 件だけ導出：Links → Prefix → Search の順で試す
    const st = loadState(seed);

    // 1) Links（現在ページからのリンク。ページ単位の plcontinue で巡回）
    if (curTitle) {
      try{
        const {links, cont} = await pageLinks(curTitle, st.plcontinue);
        st.plcontinue = cont; // 次回の続き
        saveState(seed, st);
        for(const tt of links){
          if (isDup(tt)) continue;
          try{ const s=await getSummary(tt); if(s && s.detail && !isDup(s.title)) return s; }catch{}
        }
      }catch{}
    }

    // 2) Prefix（opensearch の配列を循環参照）
    try{
      const arr = await prefixTitles(seed);
      if (arr.length){
        // prefixIdx から 1 件だけピックアップ（既読なら次）
        for (let i=0;i<arr.length;i++){
          const idx = (st.prefixIdx + i) % arr.length;
          const tt = arr[idx];
          if (isDup(tt)) continue;
          try{ const s=await getSummary(tt); if(s && s.detail && !isDup(s.title)){ st.prefixIdx = idx+1; saveState(seed, st); return s; } }catch{}
        }
        // 全滅ならインデックスを進めるだけ
        st.prefixIdx = (st.prefixIdx + 1) % arr.length; saveState(seed, st);
      }
    }catch{}

    // 3) Search（オフセットで 10 件ずつページング、必要な分だけ進める）
    try{
      let guard=0;
      while (guard++ < 5){ // 無限防止。十分軽い。
        const {titles, nextOffset} = await searchTitlesPaged(seed, st.searchOffset||0);
        st.searchOffset = nextOffset || 0; saveState(seed, st);
        for(const tt of titles){
          if (isDup(tt)) continue;
          try{ const s=await getSummary(tt); if(s && s.detail && !isDup(s.title)) return s; }catch{}
        }
        if (nextOffset == null) break; // 末尾到達
      }
    }catch{}

    return null;
  }

  async function showNextRelated(){
    if(!cooldown()) return;
    if(loading) return; loading=true; setBtns(false);
    const token=++renderToken;
    try{
      setStatus('関連を探索中…');
      const seed=getSeed();
      let s=null;
      if(seed){
        s = await nextRelatedOne(seed, current?.title);
      }
      if(!s){
        // どれも出なければランダムにフォールバックして新しい散歩を開始
        const t = await randomTitle();
        s = await getSummary(t);
        setSeed(s.title);
        clearSeedState(s.title);
      }
      render(s, token);
    }catch(e){
      console.error(e); if (titleEl) titleEl.textContent='（取得エラー）'; if (blurbEl) blurbEl.textContent='NEXTで再試行してください。'; setStatus(''); setBtns(true); loading=false;
    }
  }

  async function showNextRandom(){
    if(!cooldown()) return;
    if(loading) return; loading=true; setBtns(false);
    const token=++renderToken;
    try{
      setStatus('ランダム取得中…');
      const t = await randomTitle();
      const s = await getSummary(t);
      render(s, token);
      setSeed(s.title);             // 新しい散歩の起点
      clearSeedState(s.title);      // その種の状態は初期化
    }catch(e){
      console.error(e); if (titleEl) titleEl.textContent='（取得エラー）'; if (blurbEl) blurbEl.textContent='NEXTで再試行してください。'; setStatus(''); setBtns(true); loading=false;
    }
  }

  function applyQuery(){
    const q=(prefInput?.value||'').trim();
    if(!q){ showNextRelated(); return; }
    setSeed(q); clearSeedState(q);
    (async()=>{
      const token=++renderToken;
      try{
        setStatus('読み込み中…'); setBtns(false);
        // 入力直後は検索の先頭 1 件を即出す（重複回避）
        let s=null;
        try{
          const {titles} = await searchTitlesPaged(q, 0);
          for(const tt of titles){ if (isDup(tt)) continue;
            try{ s=await getSummary(tt); if(s && s.detail) break; }catch{} }
        }catch{}
        if(!s){
          // それでも出ないならランダムで起点を作る
          const t = await randomTitle(); s = await getSummary(t);
        }
        render(s, token);
      }catch(e){ console.error(e); setStatus(''); setBtns(true); }
    })();
  }

  nextRandomBtn?.addEventListener('click', showNextRandom, {passive:true});
  nextRelatedBtn?.addEventListener('click', showNextRelated, {passive:true});
  detailBtn?.addEventListener('click', ()=>{ if(!current) return; showAlt(`<h3>${current.title}</h3>\n${current.detail}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`); }, {passive:true});
  openBtn?.addEventListener('click', ()=>{ if(!current) return; window.open(current.url,'_blank','noopener'); }, {passive:true});
  $('backBtn')?.addEventListener('click', ()=>{ if (altview){ altview.classList.add('hidden'); altview.textContent=''; } if (maintext) maintext.classList.remove('hidden'); $('backBtn').classList.add('hidden'); }, {passive:true});
  applyBtn?.addEventListener('click', applyQuery);
  prefInput?.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); applyQuery(); } });

  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(showNextRelated, 0);
  } else {
    document.addEventListener('DOMContentLoaded', showNextRelated, {once:true});
  }

  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./serviceWorker.js'); } catch{}
  }
})();