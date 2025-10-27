'use strict';
// v21.9.1 Stable Offline Core — no network, no RELATED/CLEAR/GENRE

(function(){
  // Elements
  const $ = (id) => document.getElementById(id);
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

  // Seed (fallback topics in JP); use window.LOCAL_SEED if available
  const FALLBACK = [
    '物理学','化学','生物学','数学','天文学','コンピュータ','人工知能',
    '統計学','遺伝学','古生物学','宇宙論','地球科学','量子力学','相対性理論',
    '神経科学','心理学','機械学習','言語学','経済学','数理最適化','確率論',
    'グラフ理論','アルゴリズム','計算複雑性','暗号理論','素粒子物理学','材料科学',
    '分子生物学','進化生物学','天体物理学','情報理論','線形代数','微分幾何','トポロジー',
    'ゲーム理論','数理論理学','計量経済学','ロボティクス','制御工学','信号処理','ニューラルネットワーク'
  ];
  const BASE = (Array.isArray(window.LOCAL_SEED) && window.LOCAL_SEED.length) ? window.LOCAL_SEED.slice(0) : FALLBACK.slice(0);

  // Utils
  function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return((t^t>>>14)>>>0)/4294967296; }; }
  function seededShuffle(arr, seed){
    const rand = mulberry32(seed>>>0 || 1);
    for (let i=arr.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    return arr;
  }
  function tokenize(s){ return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }

  // State
  const seen = new Set();
  const profileKey = 'siren_profile_v21_9_1';
  const seenKey = 'siren_seen_v21_9_1';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(profileKey)||'{"tags":{}}'); }catch(_){ return {tags:{}}; } })();
  function saveProfile(){ try{ localStorage.setItem(profileKey, JSON.stringify(profile)); }catch(_){ } }
  function bumpTag(t,w){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; }
  function decay(){ for(const k in profile.tags){ profile.tags[k]*=0.9997; if(profile.tags[k]<0.12) delete profile.tags[k]; } saveProfile(); }
  setInterval(decay, 60*1000);
  function topTags(n){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }

  let pool = seededShuffle(BASE.slice(0), (crypto.getRandomValues(new Uint32Array(1))[0]^Date.now())>>>0);
  let current = null;

  // Core (offline summaries)
  function makeSummary(title){
    return {
      title,
      blurb: `（オフライン）${title} の話題です。NEXTで進みます。`,
      detail: '（詳細はWIKIで確認できます）',
      url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(title),
      description: ''
    };
  }
  async function getSummary(title){ return makeSummary(title); }
  async function refillPool(n){
    if (pool.length >= n) return;
    const seed = (crypto.getRandomValues(new Uint32Array(1))[0]^Date.now())>>>0;
    pool = pool.concat(seededShuffle(BASE.slice(0), seed));
  }

  function scoreByProfile(sum){
    const toks = tokenize(sum.title + ' ' + (sum.description||''));
    const fav = topTags(20);
    if (!fav.length) return 0;
    let sc = 0;
    for (const t of fav){
      const w = profile.tags[t]||0;
      if (!w) continue;
      for (const tk of toks){ if (tk.includes(t) || t.includes(tk)) { sc += w; break; } }
    }
    return sc;
  }

  async function pickPlain(){
    while(pool.length){
      const t = pool.shift();
      if (!seen.has(t)) return getSummary(t);
    }
    await refillPool(40);
    const t = pool.shift();
    return getSummary(t);
  }
  async function pickPersonal(){
    const n = Math.min(pool.length, 6);
    let best = null, idx=-1, bs=-1e9;
    for (let i=0;i<n;i++){
      const s = makeSummary(pool[i]); // offline: cheap
      const sc = scoreByProfile(s);
      if (sc>bs){ bs=sc; best=s; idx=i; }
    }
    if (idx>=0){ pool.splice(idx,1); return best; }
    return pickPlain();
  }
  function pickMode(){ return Math.random()<0.5 ? 'personal' : 'explore'; }

  function showMain(){ if(maintext) maintext.classList.remove('hidden'); if(altview) altview.classList.add('hidden'); if(backBtn) backBtn.classList.add('hidden'); }
  function showAlt(html){ if(altview) altview.innerHTML = html; if(maintext) maintext.classList.add('hidden'); if(altview) altview.classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden'); }
  window.showAlt = showAlt; // expose for MORE

  async function showOne(){
    try{
      setStatus('読み込み中…');
      if (pool.length < 6) await refillPool(40);
      const s = (pickMode()==='personal') ? await pickPersonal() : await pickPlain();
      current = s;
      seen.add(s.title);
      try{
        const arr = JSON.parse(localStorage.getItem(seenKey)||'[]');
        arr.push(s.title); if (arr.length>5000) arr.shift();
        localStorage.setItem(seenKey, JSON.stringify(arr));
      }catch(_){}
      if (titleEl) titleEl.textContent = `【 ${s.title} 】`;
      if (blurbEl) blurbEl.textContent = s.blurb;
      setStatus('');
      showMain();
    }catch(e){
      if (titleEl) titleEl.textContent = '（取得エラー）';
      if (blurbEl) blurbEl.textContent = 'NEXTで再試行してください。';
      setStatus('');
      showMain();
    }
  }
  window.showOne = showOne;

  async function learnFrom(sum){
    // Offline: tokens only
    const toks = tokenize(sum.title);
    for (const tk of toks){ if (tk.length>=2) bumpTag(tk, 0.5); }
    saveProfile();
  }
  window.learnFrom = learnFrom;

  // Bind
  function bindOnce(el, type, fn){ if(!el) return; const k='__b_'+type; if(el[k]) return; el.addEventListener(type, fn); el[k]=true; }
  bindOnce(nextBtn, 'click', () => showOne());
  bindOnce(detailBtn, 'click', async () => { if(!current) return; await learnFrom(current); showAlt(`<h3>DETAIL</h3>${current.detail}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`); });
  bindOnce(openBtn, 'click', async () => { if(!current) return; await learnFrom(current); if (current.url) window.open(current.url,'_blank','noopener'); });
  bindOnce(backBtn, 'click', () => showMain());

  // Boot
  (async () => {
    setStatus('起動中…');
    await refillPool(40);
    await showOne();
    setStatus('');
    console.log('✅ v21.9.1 offline core booted');
  })();

  // SW safe register (no await)
  if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    try { navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ try{ if (reg && reg.update) reg.update(); }catch(e){} }); } catch(e){}
  }
})();
