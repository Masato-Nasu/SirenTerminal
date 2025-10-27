'use strict';
// v22.1.0 Wikipedia Online — single item, real summaries, no GENRE/RELATED/CLEAR
(function(){
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

  function setStatus(t){ if(statusEl) statusEl.textContent = t||''; }
  function showMain(){ if(maintext) maintext.classList.remove('hidden'); if(altview) altview.classList.add('hidden'); if(backBtn) backBtn.classList.add('hidden'); }
  function showAlt(html){ if(altview) altview.innerHTML = html; if(maintext) maintext.classList.add('hidden'); if(altview) altview.classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden'); }
  window.showAlt = showAlt;

  // Personalization profile
  const profileKey = 'siren_profile_v22_1_0';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(profileKey)||'{"tags":{}}'); }catch(_){ return {tags:{}}; } })();
  function saveProfile(){ try{ localStorage.setItem(profileKey, JSON.stringify(profile)); }catch(_){ } }
  function bumpTag(t,w){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; }
  function decay(){ for(const k in profile.tags){ profile.tags[k]*=0.9997; if(profile.tags[k]<0.12) delete profile.tags[k]; } saveProfile(); }
  setInterval(decay, 60*1000);
  function tokenize(s){ return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function topTags(n){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }
  function scoreByProfile(title, desc){
    const fav = topTags(20);
    if (!fav.length) return 0;
    const toks = tokenize(title + ' ' + (desc||''));
    let sc=0;
    for (const t of fav){
      const w = profile.tags[t]||0; if (!w) continue;
      for (const tk of toks){ if (tk.includes(t) || t.includes(tk)) { sc += w; break; } }
    }
    return sc;
  }

  // Wikipedia helpers
  function fetchJSON(url, ms){
    return new Promise((resolve, reject)=>{
      const ctrl=new AbortController();
      const t=setTimeout(()=>{ctrl.abort(); reject(new Error('timeout'));}, ms);
      fetch(url,{mode:'cors',headers:{'Accept':'application/json'},cache:'no-store',signal:ctrl.signal})
        .then(r=> r.ok ? r.json() : Promise.reject(new Error('HTTP '+r.status)))
        .then(j=>{ clearTimeout(t); resolve(j); })
        .catch(e=>{ clearTimeout(t); reject(e); });
    });
  }
  async function getRandomTitle(ms=1500){
    try{
      const j = await fetchJSON('https://ja.wikipedia.org/api/rest_v1/page/random/title', ms);
      if (j && j.items && j.items[0] && j.items[0].title) return j.items[0].title;
    }catch(_){}
    const SEED = (Array.isArray(window.LOCAL_SEED) && window.LOCAL_SEED.length) ? window.LOCAL_SEED : [
      '物理学','化学','生物学','数学','天文学','コンピュータ','人工知能','統計学','遺伝学','古生物学','宇宙論','地球科学','量子力学','相対性理論',
      '神経科学','心理学','機械学習','言語学','経済学','数理最適化','確率論','グラフ理論','アルゴリズム','計算複雑性','暗号理論'
    ];
    return SEED[(Math.random()*SEED.length)|0];
  }
  async function getSummary(title, ms=2000){
    const url = 'https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
    const j = await fetchJSON(url, ms);
    const link = (j.content_urls && j.content_urls.desktop) ? j.content_urls.desktop.page : ('https://ja.wikipedia.org/wiki/'+encodeURIComponent(j.title||title));
    return {
      title: j.title || title,
      blurb: j.description ? String(j.description) : (j.extract ? String(j.extract).split('。')[0] + '。' : ''),
      detail: j.extract || '',
      url: link,
      description: j.description || ''
    };
  }

  async function pickOne(){
    setStatus('読み込み中…');
    const tries = 6;
    let best = null, bs = -1e9;
    for (let i=0;i<tries;i++){
      const t = await getRandomTitle(1500);
      try{
        const s = await getSummary(t, 2000);
        const sc = (Math.random()<0.5) ? scoreByProfile(s.title, s.description) : 0; // 50%個人化
        if (sc > bs){ bs = sc; best = s; }
        if (bs>0 && i>=2) break;
      }catch(_){}
    }
    if (!best){
      const t = await getRandomTitle(1500);
      best = await getSummary(t, 2500);
    }
    return best;
  }

  let current = null;

  async function showOne(){
    try{
      const s = await pickOne();
      current = s;
      if (titleEl) titleEl.textContent = `【 ${s.title} 】`;
      if (blurbEl) blurbEl.textContent = s.detail ? s.detail : (s.blurb || '（説明なし）');
      setStatus('');
      showMain();
    }catch(e){
      if (titleEl) titleEl.textContent = '（取得エラー）';
      if (blurbEl) blurbEl.textContent = 'ネット接続をご確認のうえ、NEXTで再試行してください。';
      setStatus('');
      showMain();
    }
  }
  window.showOne = showOne;

  async function learnFrom(sum){
    const toks = tokenize(sum.title + ' ' + (sum.description||''));
    for (const tk of toks){ if (tk.length>=2) bumpTag(tk, 0.5); }
    saveProfile();
  }
  window.learnFrom = learnFrom;

  function bindOnce(el, type, fn){ if(!el) return; const k='__b_'+type; if(el[k]) return; el.addEventListener(type, fn); el[k]=true; }
  bindOnce(nextBtn,   'click', () => showOne());
  bindOnce(detailBtn, 'click', async () => { if(!current) return; await learnFrom(current); showAlt(`<h3>${current.title}</h3>\n${current.detail || '(詳細なし)'}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`); });
  bindOnce(openBtn,   'click', async () => { if(!current) return; await learnFrom(current); if (current.url) window.open(current.url,'_blank','noopener'); });
  bindOnce(backBtn,   'click', () => showMain());

  (async () => {
    await showOne();
    if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ try{ if(reg&&reg.update) reg.update(); }catch(e){} }); } catch(e){}
    }
  })();
})();