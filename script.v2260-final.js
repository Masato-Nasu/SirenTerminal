'use strict';
(() => {
  if (window.__siren_lock_v2260F) return; window.__siren_lock_v2260F = true;
  const CFG = Object.assign({ SHOW_INPUT_BAR: true, TIMEOUT_MS: 6000, PRELOAD_REL_MAX: 3, LRU_MAX: 100, BLURB_MAX: 900 }, window.__SIREN_CFG || {});
  const keep = /script\.v2260-final\.js/i;
  [...document.scripts].forEach(s => { if (/\/script(\.v\d+)?\.js(\?.*)?$/i.test(s.src) && !keep.test(s.src)) s.remove(); });
  const $ = id => document.getElementById(id);
  const titleEl=$('title'), blurbEl=$('blurb'), statusEl=$('status');
  const nextBtn=$('nextBtn'), detailBtn=$('detailBtn'), openBtn=$('openBtn'), backBtn=$('backBtn');
  const maintext=$('maintext'), altview=$('altview');
  const ibarRow=$('ibarRow'), prefInput=$('prefInput'), applyBtn=$('applyBtn');
  if (!CFG.SHOW_INPUT_BAR && ibarRow) ibarRow.classList.add('hidden');
  const setStatus=t=>{ statusEl && (statusEl.textContent=t||''); };
  const showMain=()=>{ maintext?.classList.remove('hidden'); altview?.classList.add('hidden'); backBtn?.classList.add('hidden'); };
  const showAlt =html=>{ if (altview) { altview.textContent=''; altview.insertAdjacentHTML('afterbegin', html); altview.classList.remove('hidden'); } maintext?.classList.add('hidden'); backBtn?.classList.remove('hidden'); };
  const setBtns=on=>[nextBtn,detailBtn,openBtn,backBtn,applyBtn].forEach(b=>b && (b.disabled=!on));
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
  const sumCache = new Map();
  const ss = window.sessionStorage;
  const SS_KEY = 'siren_sumcache_v2260F';
  try { const raw = ss.getItem(SS_KEY); if (raw) { const obj = JSON.parse(raw); if (obj && typeof obj === 'object') for (const k in obj) sumCache.set(k, obj[k]); } } catch {}
  const saveSS = () => { try { ss.setItem(SS_KEY, JSON.stringify(Object.fromEntries(sumCache.entries()))); } catch {} };
  async function getSummary(t){ if (sumCache.has(t)) return sumCache.get(t);
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&titles=' + encodeURIComponent(t);
    const j = await jsonp(u, CFG.TIMEOUT_MS);
    const ps = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!ps.length) throw new Error('no page');
    const p = ps[0]; if (!p.extract) throw new Error('no extract');
    const val = { title: p.title||t, detail: (p.extract||'').trim(), url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(p.title||t) };
    sumCache.set(t, val); if (sumCache.size % 10 === 0) saveSS(); return val; }
  async function searchTitles(q, n=12){ const cleaned = String(q||'').replace(/[()（）：:]/g,' ').split(/\s+/).slice(0,6).join(' ');
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(cleaned) + '&srlimit=' + n + '&format=json';
    const j = await jsonp(u, CFG.TIMEOUT_MS); return (j?.query?.search||[]).map(o=>o.title); }
  async function randomTitle(){ const j = await jsonp('https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json', CFG.TIMEOUT_MS);
    return j?.query?.random?.[0]?.title || ''; }
  const LRU_KEY = 'siren_seen_titles_v2260F';
  const loadSeen = () => { try{ const a=JSON.parse(localStorage.getItem(LRU_KEY)||'[]'); return Array.isArray(a)?a.slice(-CFG.LRU_MAX):[]; }catch(_){ return []; } };
  const saveSeen = a => { try{ localStorage.setItem(LRU_KEY, JSON.stringify(a.slice(-CFG.LRU_MAX))); }catch(_){ } };
  let seen = loadSeen(); const seenSet = new Set(seen);
  function markSeen(t){ t=String(t||''); if(!t) return; if(seenSet.has(t)) seen = seen.filter(x=>x!==t); seen.push(t); while(seen.length>CFG.LRU_MAX) seen.shift(); saveSeen(seen); seenSet.clear(); seen.forEach(x=>seenSet.add(x)); }
  const dedup = (t, cur) => { const s=String(t||''); return !s || seenSet.has(s) || (cur && cur.title===s); };
  const relQueue = [];
  async function refillFromQuery(seed){
    const out=[]; const titles = await searchTitles(seed, CFG.PRELOAD_REL_MAX*2);
    for (const tt of titles){
      if (dedup(tt, current)) continue;
      try{ const s = await getSummary(tt);
        if (!s.detail || dedup(s.title, current)) continue;
        out.push(s); if (out.length >= CFG.PRELOAD_REL_MAX) break;
      }catch{}
    }
    if (out.length){ relQueue.length=0; out.forEach(x=>relQueue.push(x)); }
  }
  let current=null, renderToken=0, loading=false;
  function render(item, token){
    if (token!==renderToken) return;
    current=item; markSeen(item.title);
    const nt = `【 ${item.title} 】`; if (titleEl && titleEl.textContent !== nt) titleEl.textContent = nt;
    const text = (item.detail||'').slice(0, CFG.BLURB_MAX) || '（説明なし）';
    if (blurbEl && blurbEl.textContent !== text) blurbEl.textContent = text;
    setStatus(''); showMain(); setBtns(true); loading=false;
  }
  async function showNext(){
    if (loading) return; loading=true; setBtns(false);
    const token = ++renderToken;
    try{
      if (relQueue.length){ return render(relQueue.shift(), token); }
      setStatus('読み込み中…');
      let s = null; const last = (localStorage.getItem('siren_last_query')||'').trim();
      if (last) {
        const titles = await searchTitles(last, 8);
        for (const tt of titles){ if (dedup(tt, current)) continue;
          try{ s = await getSummary(tt); if (s && s.detail) break; }catch{} 
        }
      }
      if (!s){
        for (let i=0;i<8;i++){
          const t = await randomTitle();
          if (dedup(t, current)) continue;
          try{ s = await getSummary(t); if (s && s.detail) break; }catch{}
        }
      }
      if (!s) throw new Error('no candidate');
      render(s, token);
      const seed = (last || s.title);
      setTimeout(()=>{ refillFromQuery(seed).catch(()=>{}); }, 200);
    }catch(e){
      console.error(e); if (titleEl) titleEl.textContent='（取得エラー）'; if (blurbEl) blurbEl.textContent='NEXTで再試行してください。'; setStatus(''); setBtns(true); loading=false;
    }
  }
  function applyQuery(){
    const q=(prefInput?.value||'').trim();
    if(!q){ showNext(); return; }
    try { localStorage.setItem('siren_last_query', q); } catch{}
    (async()=>{
      const token = ++renderToken;
      try{
        setStatus('読み込み中…'); setBtns(false);
        let s=null; const titles = await searchTitles(q, 8);
        for (const tt of titles){
          if (dedup(tt, current)) continue;
          try{ s = await getSummary(tt); if (s && s.detail) break; }catch{}
        }
        if (s){ render(s, token); }
        setTimeout(()=>{ refillFromQuery(q).catch(()=>{}); }, 200);
      }catch(e){ console.error(e); setStatus(''); setBtns(true); }
    })();
  }
  if (CFG.SHOW_INPUT_BAR){
    applyBtn?.addEventListener('click', applyQuery);
    prefInput?.addEventListener('keydown', e=>{ if (e.key === 'Enter') { e.preventDefault(); applyQuery(); } });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(showNext, 0);
  } else {
    document.addEventListener('DOMContentLoaded', showNext, {once:true});
  }
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./serviceWorker.js'); } catch{}
  }
})();