'use strict';
// v22.3.5 — Always-related mode: NEXT shows a related item first (JSONP only)
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

  // ====== Profile ======
  const PROFILE_KEY = 'siren_nl_profile_v2235';
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

  // Minimal modal
  function openModal(){ modal?.classList.remove('hidden'); if (prefInput){ prefInput.value = profile.prompt || ''; setTimeout(()=>prefInput.focus(), 0); } }
  function closeModal(){ modal?.classList.add('hidden'); }
  if (!profile.prompt){ openModal(); }
  if (prefInput){
    let composing=false;
    prefInput.addEventListener('compositionstart', ()=>composing=true);
    prefInput.addEventListener('compositionend', ()=>composing=false);
    const trySave = ()=>{ const val=(prefInput.value||'').trim(); profile.prompt=val; if (val) buildVectorFromPrompt(val); else saveProfile(); closeModal(); };
    prefInput.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.keyCode===13)&&!composing){ e.preventDefault(); trySave(); } });
    prefInput.addEventListener('keyup',   e=>{ if((e.key==='Enter'||e.keyCode===13)&&!composing){ e.preventDefault(); trySave(); } });
    prefInput.addEventListener('blur', ()=>{ if(!modal.classList.contains('hidden')) trySave(); });
  }

  // ====== JSONP helpers ======
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

  async function getRandomTitle(){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json';
    const j = await jsonp(u, 8000);
    const a = (j.query && j.query.random) ? j.query.random : [];
    if (!a.length) throw new Error('no random');
    return a[0].title;
  }
  async function getSummary(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|pageimages&exintro=1&explaintext=1&piprop=thumbnail&pithumbsize=320&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u, 8000);
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) throw new Error('no page');
    const p = pages[0];
    if ((p.extract||'').includes('曖昧さ回避')) throw new Error('disambiguation');
    return {
      title: p.title || title,
      detail: (p.extract||'').trim(),
      url: 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(p.title || title),
      thumb: p.thumbnail ? p.thumbnail.source : ''
    };
  }

  // ====== Related fetchers (all JSONP) ======
  async function getLinks(title){
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&prop=links&plnamespace=0&pllimit=50&format=json&titles=' + encodeURIComponent(title);
    const j = await jsonp(u, 8000);
    const pages = j.query && j.query.pages ? Object.values(j.query.pages) : [];
    if (!pages.length) return [];
    const p = pages[0];
    const links = (p.links||[]).map(x=>x.title).filter(Boolean);
    return links;
  }
  async function getSearchRelated(seed){
    const q = seed.replace(/[()（）：:]/g,' ').split(/\s+/).slice(0,4).join(' ');
    const u = 'https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&srlimit=20&format=json';
    const j = await jsonp(u, 8000);
    const arr = (j.query && j.query.search) ? j.query.search.map(o=>o.title) : [];
    return arr;
  }

  // ====== Scoring ======
  function topTags(n){ const arr = Object.entries(profile.tags||{}); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n); }
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

  // Queues
  const BUF_MAX = 6, CONCURRENCY = 3;
  const queue = [];     // normal candidates (preference + novelty)
  const relQueue = [];  // related first queue
  let inflight = 0;
  let current=null;

  function dedupTitle(t){ const cmp = String(t||''); return queue.some(x=>x.title===cmp) || relQueue.some(x=>x.title===cmp); }

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
          if (sc > bs){ bs = sc; best = s; }
        }catch(_){}
      }
      if (best) queue.push(best);
    }finally{ inflight--; if (queue.length < BUF_MAX) fetchOneCandidate(); }
  }
  function ensureBuffer(){ while (inflight < CONCURRENCY && queue.length < BUF_MAX) fetchOneCandidate(); }

  // Related builder: from links + search; then hydrate via getSummary; keep up to 6
  async function refillRelatedFrom(seedTitle){
    try{
      const pool = new Set();
      for (const t of await getLinks(seedTitle)) pool.add(t);
      for (const t of await getSearchRelated(seedTitle)) pool.add(t);
      const titles = Array.from(pool).slice(0,40);
      const picked = [];
      for (const tt of titles){
        if (dedupTitle(tt)) continue;
        try{
          const s = await getSummary(tt);
          if (!s.detail) continue;
          picked.push(s);
          if (picked.length>=6) break;
        }catch(_){}
      }
      relQueue.length = 0;
      picked.forEach(x=>relQueue.push(x));
    }catch(e){ console.warn('refillRelated failed', e); }
  }

  // 学習（MORE/OPEN）
  function learnLight(text){ for (const t of tok(text)){ if (t.length>=2) bump('w:'+t, 0.25); } saveProfile(); }

  // 表示
  function render(item){
    if (titleEl) titleEl.textContent = `【 ${item.title} 】`;
    const text = item.detail || '（説明なし）';
    if (blurbEl) blurbEl.textContent = text.length>1200 ? (text.slice(0,1200)+' …') : text;
    setStatus(''); showMain();
    ensureBuffer();
    // 直後に関連キューを更新
    refillRelatedFrom(item.title);
  }

  async function showOneInstant(){
    // 1) まず関連キュー優先
    if (relQueue.length){ current = relQueue.shift(); render(current); return; }
    // 2) 次に通常バッファ
    if (queue.length){ current = queue.shift(); render(current); return; }
    // 3) フォールバック: 直接取得
    try{ setStatus('読み込み中…'); const t = await getRandomTitle(); current = await getSummary(t); render(current); }
    catch(e){ if (titleEl) titleEl.textContent = '（取得エラー）'; if (blurbEl) blurbEl.textContent = 'NEXTで再試行してください。'; setStatus(''); console.error(e); }
    finally{ ensureBuffer(); }
  }
  window.showOne = showOneInstant;

  // Buttons
  function bindOnce(el, type, fn){ if(!el) return; const k='__b_'+type; if(el[k]) return; el.addEventListener(type, fn); el[k]=true; }
  bindOnce(nextBtn,   'click', () => showOneInstant());
  bindOnce(detailBtn, 'click', async () => { if(!current) return; learnLight(current.title+' '+current.detail); showAlt(`<h3>${current.title}</h3>\n${current.detail || '(詳細なし)'}\n\n<p><a href="${current.url}" target="_blank" rel="noopener">WIKIを開く</a></p>`); });
  bindOnce(openBtn,   'click', async () => { if(!current) return; learnLight(current.title+' '+current.detail); if (current.url) window.open(current.url,'_blank','noopener'); });
  bindOnce(backBtn,   'click', () => { if (altview){ altview.classList.add('hidden'); altview.innerHTML=''; } if (maintext) maintext.classList.remove('hidden'); if (backBtn) backBtn.classList.add('hidden'); });

  // 起動
  ensureBuffer(); setTimeout(()=>ensureBuffer(), 50);
  // 初回は通常候補 → 表示後、関連キューが自動で補充され、次回から常に関連優先
  (async ()=>{
    try{ setStatus('読み込み中…'); const t = await getRandomTitle(); const s = await getSummary(t); current = s; render(current); }
    catch(e){ console.error(e); showOneInstant(); }
  })();

  // PWA
  (async () => {
    if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ try{ if(reg&&reg.update) reg.update(); }catch(e){} }); } catch(e){}
    }
  })();

})();