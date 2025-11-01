'use strict';
// v22.4.0 — Keyword-first, instant-related, fast render (single boot)
(function(){
  if (window.__siren_booted_v2240) return; window.__siren_booted_v2240 = true;

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
  const modal = $('prompt-modal');
  const prefInput = $('prefInput');

  // ===== utils =====
  function setStatus(t){ if(statusEl) statusEl.textContent = t||''; }
  function showMain(){ if(maintext) maintext.classList.remove('hidden'); if(altview) altview.classList.add('hidden'); if(backBtn) backBtn.classList.add('hidden'); }
  function showAlt(html){ if(altview) altview.innerHTML = html; if(maintext) maintext.classList.add('hidden'); if(altview) altview.classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden'); }

  function jsonp(url, ms=10000){
    return new Promise((resolve, reject)=>{
      const cb = '__jp_cb_' + Math.random().toString(36).slice(2);
      const s = document.createElement('script');
      const timer = setTimeout(()=>{ cleanup(); reject(new Error('timeout')); }, ms);
      function cleanup(){ clearTimeout(timer); try{ delete window[cb]; }catch(_){ window[cb]=undefined; } s.remove(); }
      window[cb] = (data)=>{ cleanup(); resolve(data); };
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      s.onerror = (e)=>{ cleanup(); reject(e); };
      document.head.appendChild(s);
    });
  }
  async function getSummary(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=320&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u, 10000);
    const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) throw new Error('no page');
    const p = pages[0];
    if ((p.extract||'').includes('曖昧さ回避')) throw new Error('disambiguation');
    return { title: p.title || title, detail: (p.extract||'').trim(), url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(p.title || title), thumb: p.thumbnail ? p.thumbnail.source : '' };
  }
  async function searchTitles(q, limit=20){
    const cleaned = String(q||'').replace(/[()（）：:]/g,' ').split(/\s+/).slice(0,6).join(' ');
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(cleaned) + '&srlimit=' + limit + '&format=json';
    const j = await jsonp(u, 10000);
    return (j?.query?.search||[]).map(o=>o.title);
  }
  async function getLinks(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=links&plnamespace=0&pllimit=50&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u, 10000);
    const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) return [];
    return (pages[0].links||[]).map(x=>x.title).filter(Boolean);
  }

  // ===== No-repeat (LRU 100) =====
  const LRU_KEY = 'siren_seen_titles_v2240';
  function loadSeen(){ try{ const a=JSON.parse(localStorage.getItem(LRU_KEY)||'[]'); return Array.isArray(a)?a.slice(-100):[]; }catch(_){ return []; } }
  function saveSeen(a){ try{ localStorage.setItem(LRU_KEY, JSON.stringify(a.slice(-100))); }catch(_){ } }
  let seen = loadSeen(); const seenSet = new Set(seen);
  function markSeen(t){ t=String(t||''); if(!t) return; if (seenSet.has(t)) seen = seen.filter(x=>x!==t); seen.push(t); while (seen.length>100) seen.shift(); saveSeen(seen); seenSet.clear(); seen.forEach(x=>seenSet.add(x)); }

  // ===== Queues =====
  const relQueue = []; // always preferred
  function dedupTitle(t, cur){ const s=String(t||''); return !s || seenSet.has(s) || relQueue.some(x=>x.title===s) || (cur && cur.title===s); }

  async function hydrateRelatedFromQuery(q, cur=null){
    const titles = await searchTitles(q, 24);
    const picked=[];
    for (const tt of titles){
      if (dedupTitle(tt, cur)) continue;
      try{
        const s = await getSummary(tt);
        if (!s.detail || dedupTitle(s.title, cur)) continue;
        picked.push(s);
        if (picked.length>=8) break;
      }catch(_){}
    }
    if (picked.length){ relQueue.length = 0; picked.forEach(x=>relQueue.push(x)); }
  }
  async function refillRelatedFromTitle(seed){
    const pool = new Set();
    try { for (const t of await getLinks(seed)) pool.add(t); } catch(_){}
    try { for (const t of await searchTitles(seed, 20)) pool.add(t); } catch(_){}
    const titles = Array.from(pool);
    const picked=[];
    for (const tt of titles){
      if (dedupTitle(tt, current)) continue;
      try{
        const s = await getSummary(tt);
        if (!s.detail || dedupTitle(s.title, current)) continue;
        picked.push(s);
        if (picked.length>=8) break;
      }catch(_){}
    }
    if (picked.length){ relQueue.length = 0; picked.forEach(x=>relQueue.push(x)); }
  }

  // ===== Render & controls =====
  let current=null, renderToken=0, loading=false;
  const setBtns = on => [nextBtn,detailBtn,openBtn,backBtn].forEach(b=>b && (b.disabled=!on));

  function render(item, token){
    if (token!==renderToken) return;
    current=item; markSeen(item.title);
    if (titleEl) titleEl.textContent = `【 ${item.title} 】`;
    const text = item.detail || '（説明なし）';
    if (blurbEl) blurbEl.textContent = text.length>1200 ? (text.slice(0,1200)+' …') : text;
    setStatus(''); showMain(); setBtns(true); loading=false;
    refillRelatedFromTitle(item.title);
  }

  async function showNext(){
    if (loading) return; loading=true; setBtns(false);
    const token = ++renderToken;
    try{
      if (relQueue.length){ return render(relQueue.shift(), token); }
      if (current){ await refillRelatedFromTitle(current.title); if (relQueue.length) return render(relQueue.shift(), token); }
      if (profile.prompt){ await hydrateRelatedFromQuery(profile.prompt, current); if (relQueue.length) return render(relQueue.shift(), token); }
      throw new Error('no candidate');
    }catch(e){
      console.error(e); if (titleEl) titleEl.textContent='（取得エラー）'; if (blurbEl) blurbEl.textContent='NEXTで再試行してください。'; setStatus(''); setBtns(true); loading=false;
    }
  }

  // ===== Prompt only profile =====
  const PROFILE_KEY = 'siren_profile_prompt_v2240';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(PROFILE_KEY)||'{"prompt":""}'); }catch(_){ return {prompt:""}; } })();
  function saveProfile(){ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }catch(_){ } }

  function startFromPrompt(text){
    profile.prompt = (text||'').trim();
    saveProfile();
    (async () => {
      try{
        setStatus('読み込み中…');
        await hydrateRelatedFromQuery(profile.prompt, null);
        if (!relQueue.length) throw new Error('empty related');
        render(relQueue.shift(), ++renderToken);
      } catch(e){
        console.error(e);
        if (titleEl) titleEl.textContent = '（取得エラー）';
        if (blurbEl) blurbEl.textContent = 'NEXTで再試行してください。';
        setStatus('');
      }
    })();
  }

  // ===== Modal enter handling =====
  function openModal(){ modal?.classList.remove('hidden'); if (prefInput){ prefInput.value = profile.prompt || ''; setTimeout(()=>prefInput.focus(), 0); } }
  function closeModal(){ modal?.classList.add('hidden'); }
  let composing=false;
  if (prefInput){
    const submit = ()=>{ const v=(prefInput.value||'').trim(); if(!v) return; closeModal(); startFromPrompt(v); };
    prefInput.addEventListener('compositionstart', ()=>composing=true);
    prefInput.addEventListener('compositionend', ()=>composing=false);
    prefInput.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.keyCode===13)&&!composing){ e.preventDefault(); submit(); } });
    prefInput.addEventListener('keyup',   e=>{ if((e.key==='Enter'||e.keyCode===13)&&!composing){ e.preventDefault(); submit(); } });
    prefInput.addEventListener('blur', ()=>{ if(!modal.classList.contains('hidden')) submit(); });
  }

  // ===== Buttons =====
  function bindOnce(el, type, fn){ if(!el) return; const k='__b_'+type; if(el[k]) return; el.addEventListener(type, fn); el[k]=true; }
  bindOnce(nextBtn,   'click', () => showNext());
  bindOnce(detailBtn, 'click', () => { if(!current) return; showAlt(`<h3>${current.title}</h3>\n${current.detail}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`); });
  bindOnce(openBtn,   'click', () => { if(!current) return; window.open(current.url,'_blank','noopener'); });
  bindOnce(backBtn,   'click', () => { if (altview){ altview.classList.add('hidden'); altview.innerHTML=''; } if (maintext) maintext.classList.remove('hidden'); if (backBtn) backBtn.classList.add('hidden'); });

  // ===== Boot =====
  if (profile.prompt){
    closeModal();
    startFromPrompt(profile.prompt);
  } else {
    openModal();
  }

  // PWA（no-op fetchなし）
  (async () => {
    if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
      try { const reg = await navigator.serviceWorker.register('./serviceWorker.js'); reg?.update?.(); } catch(e){}
    }
  })();

})();