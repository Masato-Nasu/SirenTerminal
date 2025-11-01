'use strict';
// v22.2.0 — Wikipedia JSONP Random（CORS回避 / 単項目 / 学習あり / GENRE等なし）
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

  // ---- 学習プロフィール（シンプル） ----
  const profileKey = 'siren_jsonp_profile_v2220';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(profileKey)||'{"tags":{}}'); }catch(_){ return {tags:{}}; } })();
  function saveProfile(){ try{ localStorage.setItem(profileKey, JSON.stringify(profile)); }catch(_){ } }
  function bumpTag(t,w){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; }
  function tokenize(s){ return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function topTags(n){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }
  setInterval(()=>{ for(const k in profile.tags){ profile.tags[k]*=0.9997; if(profile.tags[k]<0.12) delete profile.tags[k]; } saveProfile(); }, 60*1000);

  // ---- JSONP ヘルパー ----
  function jsonp(url, ms=8000){
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

  // ---- ランダムタイトル（Action API / JSONP / namespace=0） ----
  async function getRandomTitle(){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json';
    const j = await jsonp(u, 8000);
    const arr = (j.query && j.query.random) ? j.query.random : [];
    if (!arr.length) throw new Error('no random');
    return arr[0].title;
  }

  // ---- 要約（extracts / JSONP） ----
  async function getSummaryJSONP(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=320&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u, 8000);
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) throw new Error('no page');
    const p = pages[0];
    return {
      title: p.title || title,
      blurb: '', // description は JSONP で簡易化
      detail: (p.extract||'').trim(),
      url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(p.title || title),
      thumb: p.thumbnail ? p.thumbnail.source : ''
    };
  }

  // ---- 1件選ぶ：50% 個人化 / 50% 完全ランダム ----
  function scoreByProfile(title, text){
    const fav = topTags(24); if (!fav.length) return 0;
    const toks = tokenize(title + ' ' + (text||''));
    let sc=0; for (const t of fav){ const w=profile.tags[t]||0; if(!w) continue; if (toks.some(x=>x.includes(t)||t.includes(x))) sc+=w; }
    return sc;
  }

  async function pickOne(){
    setStatus('読み込み中…');
    const personal = Math.random() < 0.5;
    let best=null, bs=-1e9;
    // 最大6回まで候補を試す（曖昧さ回避や空頁を避ける）
    for (let i=0;i<6;i++){
      let t, s;
      try{
        t = await getRandomTitle();
        s = await getSummaryJSONP(t);
        if (!s.detail) continue;
        const sc = personal ? scoreByProfile(s.title, s.detail) : 0;
        if (sc > bs){ bs=sc; best=s; if (sc>0 && i>=2) break; }
      }catch(_){ /* 次へ */ }
    }
    if (!best) { // 最後の保険
      const t = await getRandomTitle();
      best = await getSummaryJSONP(t);
    }
    return best;
  }

  // ---- 学習（MORE/OPENで発火） ----
  async function learnFrom(sum){
    const toks = tokenize(sum.title + ' ' + (sum.detail||''));
    for (const tk of toks){ if (tk.length>=2) bumpTag(tk, 0.5); }
    saveProfile();
  }
  window.learnFrom = learnFrom;

  // ---- 表示 ----
  let current = null;
  async function showOne(){
    try{
      const s = await pickOne(); current = s;
      if (titleEl) titleEl.textContent = `【 ${s.title} 】`;
      const text = s.detail || '（説明なし）';
      if (blurbEl) blurbEl.textContent = text.length > 1200 ? (text.slice(0, 1200) + ' …') : text;
      setStatus(''); showMain();
    }catch(e){
      if (titleEl) titleEl.textContent = '（取得エラー）';
      if (blurbEl) blurbEl.textContent = 'NEXTで再試行してください。';
      setStatus('');
      console.error('JSONP random failed:', e);
    }
  }
  window.showOne = showOne;

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