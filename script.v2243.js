'use strict';
// v22.4.3 — Minimal input bar (summonable) + auto-run + anti-double + related-first
(() => {
  if (window.__siren_lock_v2243) return; window.__siren_lock_v2243 = true;

  // Anti double-load
  const keep = /script\.v2243\.js/i;
  const purge = () => { [...document.scripts].forEach(s => { if (/\/script(\.v\d+)?\.js(\?.*)?$/i.test(s.src) && !keep.test(s.src)) s.remove(); }); };
  purge();
  const mo = new MutationObserver(purge);
  mo.observe(document.documentElement, {childList:true, subtree:true});

  const $ = id => document.getElementById(id);
  const titleEl = $('title');
  const blurbEl = $('blurb');
  const nextBtn = $('nextBtn');
  const detailBtn = $('detailBtn');
  const openBtn = $('openBtn');
  const backBtn = $('backBtn');
  const maintext = $('maintext');
  const altview = $('altview');
  const statusEl = $('status');

  // input bar
  const ibar = $('ibar');
  const summonBtn = $('summonBtn');
  const prefInput = $('prefInput');
  const applyBtn = $('applyBtn');
  const hideBtn = $('hideBtn');

  const setStatus = t => { statusEl && (statusEl.textContent = t||''); };
  const showMain = () => { maintext?.classList.remove('hidden'); altview?.classList.add('hidden'); backBtn?.classList.add('hidden'); };
  const showAlt  = html => { if (altview) { altview.innerHTML = html; altview.classList.remove('hidden'); } maintext?.classList.add('hidden'); backBtn?.classList.remove('hidden'); };

  // JSONP util
  function jsonp(url, ms=10000){
    return new Promise((resolve, reject)=>{
      const cb='__jp_'+Math.random().toString(36).slice(2);
      const s=document.createElement('script');
      const to=setTimeout(()=>{ cleanup(); reject(new Error('timeout')); }, ms);
      function cleanup(){ clearTimeout(to); try{ delete window[cb]; }catch(_){ window[cb]=undefined; } s.remove(); }
      window[cb]=d=>{ cleanup(); resolve(d); };
      s.src = url + (url.includes('?')?'&':'?') + 'callback=' + cb;
      s.onerror = e => { cleanup(); reject(e); };
      document.head.appendChild(s);
    });
  }
  async function getSummary(t){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=320&format=json&titles=' + encodeURIComponent(t);
    const j = await jsonp(u, 10000);
    const ps = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!ps.length) throw new Error('no page');
    const p = ps[0];
    if ((p.extract||'').includes('曖昧さ回避')) throw new Error('disambiguation');
    return { title: p.title||t, detail: (p.extract||'').trim(), url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(p.title||t) };
  }
  async function searchTitles(q, n=20){
    const cleaned = String(q||'').replace(/[()（）：:]/g,' ').split(/\s+/).slice(0,6).join(' ');
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(cleaned) + '&srlimit=' + n + '&format=json';
    const j = await jsonp(u, 10000);
    return (j?.query?.search||[]).map(o=>o.title);
  }
  async function getLinks(t){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=links&plnamespace=0&pllimit=50&format=json&titles=' + encodeURIComponent(t);
    const j = await jsonp(u, 10000);
    const ps = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!ps.length) return [];
    return (ps[0].links||[]).map(x=>x.title).filter(Boolean);
  }

  // No-repeat LRU
  const LRU_KEY = 'siren_seen_titles_v2243';
  const loadSeen = () => { try{ const a=JSON.parse(localStorage.getItem(LRU_KEY)||'[]'); return Array.isArray(a)?a.slice(-100):[]; }catch(_){ return []; } };
  const saveSeen = a => { try{ localStorage.setItem(LRU_KEY, JSON.stringify(a.slice(-100))); }catch(_){ } };
  let seen = loadSeen(); const seenSet = new Set(seen);
  function markSeen(t){ t=String(t||''); if(!t) return; if(seenSet.has(t)) seen = seen.filter(x=>x!==t); seen.push(t); while(seen.length>100) seen.shift(); saveSeen(seen); seenSet.clear(); seen.forEach(x=>seenSet.add(x)); }

  const relQueue = [];
  const dedup = (t, cur) => { const s=String(t||''); return !s || seenSet.has(s) || relQueue.some(x=>x.title===s) || (cur && cur.title===s); };

  async function refillFromTitle(seed){
    const pool = new Set();
    try { (await getLinks(seed)).forEach(x=>pool.add(x)); } catch(_){}
    try { (await searchTitles(seed, 20)).forEach(x=>pool.add(x)); } catch(_){}
    const out=[];
    for (const tt of pool){ if (dedup(tt, current)) continue;
      try{ const s=await getSummary(tt); if(!s.detail || dedup(s.title, current)) continue; out.push(s); if(out.length>=8) break; }catch(_){}
    }
    if (out.length){ relQueue.length=0; out.forEach(x=>relQueue.push(x)); }
  }

  // Render
  let current=null, renderToken=0, loading=false;
  const setBtns = on => [nextBtn,detailBtn,openBtn,backBtn].forEach(b=>b && (b.disabled=!on));

  function render(item, token){
    if (token!==renderToken) return;
    current=item; markSeen(item.title);
    titleEl && (titleEl.textContent = `【 ${item.title} 】`);
    const text = item.detail || '（説明なし）';
    blurbEl && (blurbEl.textContent = text.length>1200 ? (text.slice(0,1200)+' …') : text);
    setStatus(''); showMain(); setBtns(true); loading=false;
    refillFromTitle(item.title);
  }

  async function showNext(){
    if (loading) return; loading=true; setBtns(false);
    const token = ++renderToken;
    try{
      if (relQueue.length){ return render(relQueue.shift(), token); }
      if (current){ await refillFromTitle(current.title); if (relQueue.length) return render(relQueue.shift(), token); }
      // last resort random 10
      setStatus('読み込み中…');
      for (let i=0;i<10;i++){
        const j = await jsonp('https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json');
        const t = j?.query?.random?.[0]?.title;
        if (dedup(t, current)) continue;
        const s = await getSummary(t);
        if (!s.detail || dedup(s.title, current)) continue;
        return render(s, token);
      }
      throw new Error('no candidate');
    }catch(e){
      console.error(e); titleEl && (titleEl.textContent='（取得エラー）'); blurbEl && (blurbEl.textContent='NEXTで再試行してください。'); setStatus(''); setBtns(true); loading=false;
    }
  }

  // Input bar behavior
  function openIbar(){ ibar?.classList.add('show'); prefInput?.focus(); }
  function closeIbar(){ ibar?.classList.remove('show'); }
  function applyQuery(){
    const q=(prefInput?.value||'').trim();
    if(!q) { closeIbar(); return; }
    try { localStorage.setItem('siren_last_query', q); } catch(_){}
    // hydrate queue from query, then render 1
    (async () => {
      try{
        relQueue.length = 0;
        // use search -> summaries
        const titles = await searchTitles(q, 24);
        const picked=[];
        for (const tt of titles){
          if (dedup(tt, current)) continue;
          try{
            const s = await getSummary(tt);
            if (!s.detail || dedup(s.title, current)) continue;
            picked.push(s);
            if (picked.length>=8) break;
          }catch(_){}
        }
        picked.forEach(x=>relQueue.push(x));
        if (relQueue.length){
          render(relQueue.shift(), ++renderToken);
        }
      }catch(e){ console.error(e); }
    })();
    closeIbar();
  }

  summonBtn?.addEventListener('click', openIbar);
  applyBtn?.addEventListener('click', applyQuery);
  hideBtn?.addEventListener('click', closeIbar);
  prefInput?.addEventListener('keydown', e=>{
    if (e.key === 'Enter') { e.preventDefault(); applyQuery(); }
    if (e.key === 'Escape') { e.preventDefault(); closeIbar(); }
  });

  // Keyboard shortcuts: Ctrl+K or / to open
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'k')) { e.preventDefault(); openIbar(); }
    else if (!e.ctrlKey && !e.metaKey && e.key === '/') { e.preventDefault(); openIbar(); }
  }, {passive:false});

  // AUTO RUN
  const boot = async () => {
    try{
      const last = (localStorage.getItem('siren_last_query')||'').trim();
      if (last) {
        // prefill queue from last query
        const titles = await searchTitles(last, 24);
        for (const tt of titles){
          if (dedup(tt, null)) continue;
          try{
            const s = await getSummary(tt);
            if (!s.detail || dedup(s.title, null)) continue;
            relQueue.push(s);
            if (relQueue.length>=8) break;
          }catch(_){}
        }
      }
      showNext();
    }catch(_){ showNext(); }
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', boot, {once:true});
  }

  // SW register (no fetch handler)
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./serviceWorker.js'); } catch(e){}
  }
})();