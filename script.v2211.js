'use strict';
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

  // profile
  const profileKey = 'siren_pop_profile_v2211';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(profileKey)||'{"tags":{}}'); }catch(_){ return {tags:{}}; } })();
  function saveProfile(){ try{ localStorage.setItem(profileKey, JSON.stringify(profile)); }catch(_){ } }
  function bumpTag(t,w){ if(!t) return; profile.tags[t]=(profile.tags[t]||0)+w; }
  function tokenize(s){ return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function topTags(n){ const arr = Object.entries(profile.tags); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n).map(x=>x[0]); }
  setInterval(()=>{ for(const k in profile.tags){ profile.tags[k]*=0.9997; if(profile.tags[k]<0.12) delete profile.tags[k]; } saveProfile(); }, 60*1000);

  // helpers
  function fetchJSON(url, ms=3000){
    return new Promise((resolve, reject)=>{
      const ctrl=new AbortController();
      const t=setTimeout(()=>{ctrl.abort(); reject(new Error('timeout'));}, ms);
      fetch(url,{mode:'cors',headers:{'Accept':'application/json'},cache:'no-store',signal:ctrl.signal})
        .then(r=> r.ok ? r.json() : Promise.reject(new Error('HTTP '+r.status)))
        .then(j=>{ clearTimeout(t); resolve(j); })
        .catch(e=>{ clearTimeout(t); reject(e); });
    });
  }
  function ymd(d=new Date()){ const pad=n=>(n<10?'0':'')+n; return {y:d.getFullYear(), m:pad(d.getMonth()+1), d:pad(d.getDate())}; }

  async function getMostReadTitles(){
    async function fetchDay(date){
      const {y,m,d} = ymd(date);
      const url = `https://ja.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`;
      const j = await fetchJSON(url, 3500);
      const items = (j.mostread && j.mostread.articles) ? j.mostread.articles : [];
      return items.map(a=>a.normalizedtitle || a.title).filter(t => t && !/^Portal:|^Wikipedia:|^特集|^メインページ/i.test(t));
    }
    try { return await fetchDay(new Date()); }
    catch(_){ const d=new Date(); d.setDate(d.getDate()-1); return await fetchDay(d); }
  }

  async function getSummary(title){
    const url = 'https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
    const j = await fetchJSON(url, 3000);
    const link = (j.content_urls && j.content_urls.desktop) ? j.content_urls.desktop.page : ('https://ja.wikipedia.org/wiki/'+encodeURIComponent(j.title||title));
    return {
      title: j.title || title,
      blurb: j.description ? `これは：${j.description}` : '',
      detail: (j.extract||'').trim(),
      url: link,
      description: j.description || '',
      type: j.type || ''
    };
  }

  function guessCategory(desc=''){
    const d=String(desc);
    if (/歌手|俳優|声優|ミュージシャン|人物|政治家|小説家/.test(d)) return '人物';
    if (/サッカー|野球|バスケット|スポーツ|選手|監督/.test(d)) return 'スポーツ';
    if (/映画|アニメ|ドラマ|テレビ番組|漫画|小説|ゲーム|作品/.test(d)) return '作品';
    if (/企業|会社|メーカー|ブランド|法人/.test(d)) return '企業';
    if (/市|町|村|県|州|国|地名|島|山|川|湖/.test(d)) return '地理';
    if (/寺院|神社|城|遺跡|史跡|歴史/.test(d)) return '歴史';
    if (/動物|植物|生物|種|科|属/.test(d)) return '生物';
    if (/ソフトウェア|プログラミング|コンピュータ|技術/.test(d)) return 'テック';
    if (/数学|物理|化学|生物学|経済学|言語学|哲学|学問/.test(d)) return '学問';
    return 'その他';
  }

  function scoreByProfile(title, desc){
    const fav = topTags(24); if (!fav.length) return 0;
    const toks = tokenize(title + ' ' + (desc||''));
    let sc=0; for (const t of fav){ const w=profile.tags[t]||0; if(!w) continue; if (toks.some(x=>x.includes(t)||t.includes(x))) sc+=w; }
    return sc;
  }

  // balance for geography
  const hist = (window.__SIREN_hist_pop = window.__SIREN_hist_pop || []);
  const weights = { '地理': 0.6 }; // others: 1.0
  const historySize = 6;
  const maxGeo = 1;
  function rotatePenalty(cat){ const last=hist.slice(-historySize); const same=last.filter(c=>c===cat).length; return same>0 ? -0.2*same : 0; }
  function geoOverCap(){ const last=hist.slice(-historySize); return last.filter(c=>c==='地理').length >= maxGeo; }

  async function pickOnePopular(){
    setStatus('読み込み中…');
    const titles = await getMostReadTitles();
    if (!titles || !titles.length) throw new Error('no most-read');
    const cand = titles.slice(0, 20);
    const items = [];
    for (const t of cand){
      try{
        const s = await getSummary(t);
        if (s.type === 'disambiguation') continue;
        items.push({...s, _cat: guessCategory(s.description)});
      }catch(_){}
    }
    if (!items.length) throw new Error('no summaries');
    const personalMode = Math.random() < 0.5;
    let best=null, bs=-1e9, geoCandidate=null;
    for (const it of items){
      const w = (weights[it._cat] ?? 1);
      const sp = personalMode ? scoreByProfile(it.title, it.description) : 0;
      const rot = rotatePenalty(it._cat);
      let sc = w*(1+sp*0.25) + rot + Math.random()*0.01;
      if (it._cat === '地理' && geoOverCap()) sc -= 999;
      if (it._cat === '地理' && (!geoCandidate || sc>geoCandidate.sc)) geoCandidate = {it, sc};
      if (sc > bs){ bs=sc; best=it; }
    }
    if (!best && geoCandidate) best = geoCandidate.it;
    hist.push(best._cat); if (hist.length > historySize) hist.shift();
    return best;
  }

  let current = null;
  async function showOne(){
    try{
      const s = await pickOnePopular(); current = s;
      if (altview) altview.innerHTML = '';
      if (titleEl) titleEl.textContent = `【 ${s.title} 】`;
      if (blurbEl) blurbEl.textContent = s.blurb || `これは：${s._cat || 'その他'}`;
      setStatus(''); showMain();
    }catch(e){
      if (titleEl) titleEl.textContent = '（取得エラー）';
      if (blurbEl) blurbEl.textContent = 'NEXTで再試行してください。';
      setStatus(''); showMain();
    }
  }
  window.showOne = showOne;

  async function learnFrom(sum){
    const toks = tokenize(sum.title + ' ' + (sum.description||''));
    for (const tk of toks){ if (tk.length>=2) bumpTag(tk, 0.5); }
    bumpTag('cat:'+guessCategory(sum.description), 0.8);
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