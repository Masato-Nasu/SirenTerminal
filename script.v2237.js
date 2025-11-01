'use strict';
// v22.3.7 — Hard-fix: guaranteed first render + related-first + watchdogs
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
  const modal = $('prompt-modal');
  const prefInput = $('prefInput');

  function setStatus(t){ if(statusEl) statusEl.textContent = t||''; }
  function showMain(){ if(maintext) maintext.classList.remove('hidden'); if(altview) altview.classList.add('hidden'); if(backBtn) backBtn.classList.add('hidden'); }
  function showAlt(html){ if(altview) altview.innerHTML = html; if(maintext) maintext.classList.add('hidden'); if(altview) altview.classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden'); }
  window.showAlt = showAlt;

  // ===== Profile =====
  const PROFILE_KEY = 'siren_nl_profile_v2237';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(PROFILE_KEY)||'{"tags":{},"prompt":""}'); }catch(_){ return {tags:{}, prompt:''}; }})();
  const saveProfile = ()=>{ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }catch(_){ } };
  const tok = s => String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const bump = (tag,w)=>{ if(!tag) return; profile.tags[tag]=(profile.tags[tag]||0)+w; };

  const SYNS = {
    anime:['アニメ','ova','アニメ映画','テレビアニメ'], manga:['漫画','コミック','コミックス'], ln:['ラノベ','ライトノベル'],
    vtuber:['vtuber','バーチャルyoutuber','ぶいちゅーばー'], tokusatsu:['特撮','仮面ライダー','ウルトラマン','スーパー戦隊'],
    game:['ゲーム','rpg','アクション','シューティング','格闘'],
    metaphysics:['形而上学','存在論','本体論'], epistemology:['認識論','懐疑主義','正当化'], ethics:['倫理学','功利主義','徳倫理','義務論'],
    logic:['論理学','様相論理','記号論理'], phenomenology:['現象学','実存主義','サルトル','ハイデガー'], analytic:['分析哲学','フレーゲ','ラッセル','ウィトゲンシュタイン'],
    pistol:['拳銃','ハンドガン','ピストル'], ar:['アサルトライフル','自動小銃','突撃銃'], tank:['主力戦車','戦車','mbt'],
    destroyer:['駆逐艦'], submarine:['潜水艦'], carrier:['空母'], fighter:['戦闘機'], uav:['無人機','ドローン'],
    algebra:['代数','群論','環論','線形代数'], geometry:['幾何','微分幾何','位相幾何','トポロジー'], analysis:['解析','複素解析','実解析','微分方程式']
  };

  function buildVectorFromPrompt(text){
    profile.tags = {};
    const T = tok(text);
    const joined = ' ' + T.join(' ') + ' ';
    for (const [tag, words] of Object.entries(SYNS)){
      for (const w of words){
        if (joined.includes(String(w).toLowerCase())){ bump('pref:'+tag, 4.0); break; }
      }
    }
    for (const t of T){ if (t.length>=2) bump('w:'+t, 0.25); }
    saveProfile();
  }

  // ===== Modal (Enter/IME対応) =====
  function openModal(){ modal?.classList.remove('hidden'); if (prefInput){ prefInput.value = profile.prompt || ''; setTimeout(()=>prefInput.focus(), 0); } }
  function closeModal(){ modal?.classList.add('hidden'); }
  function hasProfile(){ return !!(profile && (profile.prompt||'').length); }
  if (!hasProfile()){ openModal(); } else { closeModal(); }

  if (prefInput){
    let composing=false;
    const trySave = ()=>{ const val=(prefInput.value||'').trim(); profile.prompt=val; if (val) buildVectorFromPrompt(val); else saveProfile(); closeModal(); ensureRelFromPref(); };
    prefInput.addEventListener('compositionstart', ()=>composing=true);
    prefInput.addEventListener('compositionend', ()=>composing=false);
    prefInput.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.keyCode===13)&&!composing){ e.preventDefault(); trySave(); } });
    prefInput.addEventListener('keyup',   e=>{ if((e.key==='Enter'||e.keyCode===13)&&!composing){ e.preventDefault(); trySave(); } });
    prefInput.addEventListener('blur', ()=>{ if(!modal.classList.contains('hidden')) trySave(); });
  }

  // ===== JSONP helpers =====
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
  async function getRandomTitle(){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json';
    const j = await jsonp(u);
    const a = j?.query?.random || [];
    if (!a.length) throw new Error('no random');
    return a[0].title;
  }
  async function getSummary(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=320&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u);
    const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) throw new Error('no page');
    const p = pages[0];
    if ((p.extract||'').includes('曖昧さ回避')) throw new Error('disambiguation');
    return { title: p.title || title, detail: (p.extract||'').trim(), url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(p.title || title), thumb: p.thumbnail ? p.thumbnail.source : '' };
  }
  async function getLinks(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=links&plnamespace=0&pllimit=50&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u);
    const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) return [];
    return (pages[0].links||[]).map(x=>x.title).filter(Boolean);
  }
  async function getSearchRelated(seed){
    const q = seed.replace(/[()（）：:]/g,' ').split(/\s+/).slice(0,6).join(' ');
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&srlimit=20&format=json';
    const j = await jsonp(u);
    return (j?.query?.search||[]).map(o=>o.title);
  }

  // ===== Preference query =====
  function topTags(n){ const arr = Object.entries(profile.tags||{}); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n); }
  function buildQueryFromProfile(){
    const keys = [];
    for (const [tag,_w] of topTags(12)){
      const key = tag.startsWith('pref:') ? tag.slice(5) : (tag.startsWith('w:') ? tag.slice(2) : null);
      if (!key) continue;
      if (SYNS[key]) keys.push(...SYNS[key].slice(0,2));
      else keys.push(key);
      if (keys.length>=6) break;
    }
    if (!keys.length && profile.prompt) keys.push(profile.prompt);
    return keys.slice(0,6).join(' ');
  }

  // ===== Queues =====
  const BUF_MAX = 6, CONCURRENCY = 3;
  const queue = [];
  const relQueue = [];
  let inflight = 0;
  let current = null;
  let firstRendered = false;

  function dedupTitle(t){ const s=String(t||''); return queue.some(x=>x.title===s) || relQueue.some(x=>x.title===s); }

  async function fetchOneCandidate(){
    if (queue.length >= BUF_MAX || inflight >= CONCURRENCY) return;
    inflight++;
    try{
      let best=null, bs=-1e9;
      for (let tries=0; tries<20; tries++){
        try{
          const t = await getRandomTitle();
          if (dedupTitle(t)) continue;
          const s = await getSummary(t);
          if (!s.detail) continue;
          const sc = scoreByPref(s.title, s.detail);
          if (sc > bs){ bs=sc; best = s; }
        }catch(_){}
      }
      if (best) queue.push(best);
    }finally{ inflight--; if (queue.length < BUF_MAX) fetchOneCandidate(); }
  }
  function ensureBuffer(){ while (inflight < CONCURRENCY && queue.length < BUF_MAX) fetchOneCandidate(); }

  async function hydrateInto(targetQueue, titles, maxN=8){
    const picked=[];
    for (const tt of titles){
      if (dedupTitle(tt)) continue;
      try{
        const s = await getSummary(tt);
        if (!s.detail) continue;
        picked.push(s);
        if (picked.length>=maxN) break;
      }catch(_){}
    }
    if (picked.length){
      while (targetQueue.length) targetQueue.pop();
      picked.forEach(x=>targetQueue.push(x));
    }
  }

  async function refillRelatedFromTitle(seedTitle){
    try{
      const pool = new Set();
      for (const t of await getLinks(seedTitle)) pool.add(t);
      for (const t of await getSearchRelated(seedTitle)) pool.add(t);
      await hydrateInto(relQueue, Array.from(pool), 8);
    }catch(e){ console.warn('refillRelatedFromTitle failed', e); }
  }

  async function ensureRelFromPref(){
    if (relQueue.length) return;
    const q = buildQueryFromProfile();
    if (!q) return;
    const titles = await getSearchRelated(q);
    await hydrateInto(relQueue, titles, 8);
  }

  // ===== Scoring =====
  function scoreByPref(title, text){
    const joined = (' '+String(title).toLowerCase()+' '+String(text).toLowerCase()+' ');
    let sc = 0;
    for (const [tag, w] of topTags(64)){
      const key = tag.startsWith('pref:') ? tag.slice(5) : (tag.startsWith('w:') ? tag.slice(2) : null);
      if (!key) continue;
      if (SYNS[key]){
        for (const k of SYNS[key]){ if (joined.includes(String(k).toLowerCase())){ sc += w * 2.5; break; } }
      } else { if (joined.includes(key)) sc += w * 1.0; }
    }
    const tl = String(title||'').toLowerCase();
    for (const [tag, w] of topTags(32)){
      const key = tag.startsWith('pref:') ? tag.slice(5) : null;
      if (key && SYNS[key]){ for (const k of SYNS[key]){ if (tl.includes(String(k).toLowerCase())){ sc += w * 3.5; break; } } }
    }
    return sc;
  }

  // ===== Learning =====
  function learnLight(text){ for (const t of tok(text)){ if (t.length>=2) bump('w:'+t, 0.25); } saveProfile(); }

  // ===== Rendering =====
  function render(item){
    firstRendered = true;
    if (titleEl) titleEl.textContent = `【 ${item.title} 】`;
    const text = item.detail || '（説明なし）';
    if (blurbEl) blurbEl.textContent = text.length>1200 ? (text.slice(0,1200)+' …') : text;
    setStatus(''); showMain();
    ensureBuffer();
    refillRelatedFromTitle(item.title);
  }

  async function showOneInstant(){
    try{
      // 1) 関連最優先（なければprefで補充）
      if (!relQueue.length) await ensureRelFromPref();
      if (relQueue.length){ const it = relQueue.shift(); render(it); return; }
      // 2) 通常バッファ
      if (queue.length){ const it = queue.shift(); render(it); return; }
      // 3) フォールバック
      setStatus('読み込み中…');
      const t = await getRandomTitle(); const s = await getSummary(t); render(s);
    }catch(e){
      console.error(e);
      if (titleEl) titleEl.textContent = '（取得エラー）';
      if (blurbEl) blurbEl.textContent = 'NEXTで再試行してください。';
      setStatus('');
    }
  }
  window.showOne = showOneInstant;

  // Buttons（再配線の保険）
  function wireButtons(){
    const bind = (el, type, fn)=>{ if(!el) return; el.replaceWith(el.cloneNode(true)); const ne = $(el.id); ne.addEventListener(type, fn); };
    bind(nextBtn, 'click', () => showOneInstant());
    bind(detailBtn,'click', () => { if(!titleEl||!blurbEl) return; const t=titleEl.textContent.replace(/^[【\s]+|[】\s]+$/g,''); const d=blurbEl.textContent; learnLight(t+' '+d); showAlt(`<h3>${t}</h3>\n${d}\n\n<p><a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(t)}" target="_blank" rel="noopener">WIKIを開く</a></p>`); });
    bind(openBtn,  'click', () => { const t=titleEl.textContent.replace(/^[【\s]+|[】\s]+$/g,''); learnLight(t); window.open('https://ja.wikipedia.org/wiki/'+encodeURIComponent(t),'_blank','noopener'); });
    bind(backBtn,  'click', () => { if (altview){ altview.classList.add('hidden'); altview.innerHTML=''; } if (maintext) maintext.classList.remove('hidden'); if (backBtn) backBtn.classList.add('hidden'); });
  }
  wireButtons();

  // ===== Boot sequence with watchdogs =====
  (async () => {
    try{
      // SW登録（軽量）
      if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
        try { const reg = await navigator.serviceWorker.register('./serviceWorker.js'); reg?.update?.(); } catch(e){}
      }
      // 起動直後のpref関連補充 + 初回表示
      await ensureRelFromPref();
      await showOneInstant();
    } finally {
      // 2秒後に監視：何も描画されてなければ再度 showOne
      setTimeout(() => { if (!firstRendered) { console.warn('watchdog: retry'); showOneInstant(); } }, 2000);
      // 5秒後も無ならモーダル強制閉じ＋再配線＋再表示
      setTimeout(() => {
        if (!firstRendered) {
          console.warn('watchdog: force modal hide & rewire');
          if (modal) { modal.style.display='none'; modal.classList.add('hidden'); }
          wireButtons(); showOneInstant();
        }
      }, 5000);
    }
  })();

})();