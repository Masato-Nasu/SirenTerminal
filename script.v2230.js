'use strict';
// v22.3.0 — Natural language genre preference + JSONP + prefetch buffer
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
  const prefSave = $('prefSave');
  const skipBtn  = $('skipBtn');
  const pillbox  = $('pillbox');

  function setStatus(t){ if(statusEl) statusEl.textContent = t||''; }
  function showMain(){ if(maintext) maintext.classList.remove('hidden'); if(altview) altview.classList.add('hidden'); if(backBtn) backBtn.classList.add('hidden'); }
  function showAlt(html){ if(altview) altview.innerHTML = html; if(maintext) maintext.classList.add('hidden'); if(altview) altview.classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden'); }
  window.showAlt = showAlt;

  // ====== Profile (自然言語 → ベクトル) ======
  const PROFILE_KEY = 'siren_nl_profile_v2230';
  let profile = (()=>{ try{ return JSON.parse(localStorage.getItem(PROFILE_KEY)||'{"tags":{},"prompt":""}'); }catch(_){ return {tags:{}, prompt:''}; }})();
  function saveProfile(){ try{ localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }catch(_){ } }
  function tok(s){ return String(s||'').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
  function bump(tag, w){ if(!tag) return; profile.tags[tag]=(profile.tags[tag]||0)+w; }

  // ジャンル語彙 → 内部タグの粗い辞書（synonyms）
  const SYNS = {
    // otaku / works
    anime:['アニメ','ova','テレビアニメ','アニメ映画'],
    manga:['漫画','コミック','コミックス','少年漫画','青年漫画','少女漫画','漫画家'],
    ln:['ラノベ','ライトノベル'],
    vtuber:['vtuber','ぶいちゅーばー','バーチャルyoutuber'],
    tokusatsu:['特撮','仮面ライダー','ウルトラマン','スーパー戦隊'],
    game:['ゲーム','rpg','アクションゲーム','シューティング','格闘ゲーム','ビデオゲーム','コンピュータゲーム'],

    // philosophy (detailed)
    metaphysics:['形而上学','存在論','本体論','メタフィジックス','実在論','唯名論'],
    epistemology:['認識論','知識論','懐疑主義','正当化'],
    ethics:['倫理学','徳倫理','義務論','功利主義','応用倫理','メタ倫理'],
    aesthetics:['美学','芸術哲学','審美'],
    logic:['論理学','様相論理','記号論理','推論','証明'],
    phil_mind:['心の哲学','意識','クオリア','心身問題','機能主義'],
    phil_lang:['言語哲学','意味論','指示','語用論','分析哲学'],
    phil_sci:['科学哲学','実証主義','反証可能性','実在論'],
    phil_tech:['技術哲学','テクノロジー','ai 倫理','設計倫理'],
    phil_politics:['政治哲学','自由','正義','平等','ロールズ'],
    phil_religion:['宗教哲学','神学','有神論','神義論'],
    phil_math:['数学の哲学','基礎論','集合論','直観主義'],
    continental:['大陸哲学','フーコー','デリダ','ドゥルーズ','ラカン'],
    analytic:['分析哲学','フレーゲ','ラッセル','クワイン','ウィトゲンシュタイン'],
    phenomenology:['現象学','実存主義','ハイデガー','サルトル','メルロ=ポンティ'],

    // weapons / vehicles
    pistol:['拳銃','ハンドガン','ピストル'],
    smg:['サブマシンガン','短機関銃','smg'],
    ar:['アサルトライフル','自動小銃','突撃銃'],
    sniper:['狙撃銃','スナイパーライフル'],
    shotgun:['散弾銃','ショットガン'],
    mg:['機関銃','軽機関銃','重機関銃','gpmg','lmg','hmg'],
    tank:['主力戦車','mbt','戦車'],
    ifv:['歩兵戦闘車','ifv'],
    apc:['装甲兵員輸送車','apc'],
    spa:['自走砲','榴弾砲','野戦砲','迫撃砲','ロケット砲'],
    sam:['対空ミサイル','sam','地対空'],
    asm:['対艦ミサイル','asm','艦対艦'],
    atgm:['対戦車ミサイル','atgm','携行対戦車'],
    heli:['ヘリ','ヘリコプター','攻撃ヘリ','多用途ヘリ'],
    fighter:['戦闘機','制空'],
    bomber:['爆撃機','bomber'],
    uav:['無人機','ドローン','uav'],
    frigate:['フリゲート','護衛艦'],
    destroyer:['駆逐艦'],
    submarine:['潜水艦','原潜','通常動力潜水艦'],
    carrier:['空母','航空母艦'],
    car_sport:['スポーツカー','クーペ','ロードスター'],
    car_sedan:['セダン'],
    car_suv:['suv','クロスオーバー'],
    motorcycle:['オートバイ','バイク','二輪'],

    // sciences (sample)
    algebra:['代数','群論','環論','表現論','線形代数','可換'],
    geometry:['幾何','微分幾何','位相幾何','トポロジー','多様体'],
    analysis:['解析','実解析','複素解析','フーリエ','微分方程式','関数解析','測度'],
    probability:['確率','統計','ベイズ','マルコフ'],
    number:['数論','解析数論','代数的数論'],
    physics_quantum:['量子','量子力学','量子場','量子情報'],
    physics_relativity:['相対論','一般相対','特殊相対','重力'],
    physics_astro:['宇宙','宇宙論','天体','銀河','恒星'],
  };

  // 入力文からシノニム辞書にマッチ → tag に重み付け
  function buildVectorFromPrompt(text){
    const T = tok(text);
    // まず全体を1本文字列化し、部分一致も許容
    const joined = ' ' + T.join(' ') + ' ';
    for (const [tag, words] of Object.entries(SYNS)){
      for (const w of words){
        if (joined.includes(String(w).toLowerCase())){
          bump('pref:'+tag, 3.0); // 初期重み
          break;
        }
      }
    }
    // 生の単語も薄く拾う
    for (const t of T){ if (t.length>=2) bump('w:'+t, 0.2); }
  }

  // モーダルUI
  function closeModal(){ modal?.classList.add('hidden'); }
  function openModal(){ modal?.classList.remove('hidden'); if (prefInput) prefInput.value = profile.prompt || ''; }
  if (pillbox){
    pillbox.addEventListener('click', (e)=>{
      const t = e.target;
      if (t && t.classList.contains('pill')){
        if (prefInput) prefInput.value = (prefInput.value ? (prefInput.value + ' ') : '') + t.textContent.trim();
      }
    });
  }
  if (prefSave){
    prefSave.addEventListener('click', ()=>{
      const val = (prefInput?.value||'').trim();
      profile.prompt = val;
      // 初期化して再構築
      profile.tags = {};
      if (val) buildVectorFromPrompt(val);
      saveProfile();
      closeModal();
    });
  }
  if (skipBtn){
    skipBtn.addEventListener('click', ()=>{ closeModal(); });
  }

  // 初回のみ案内（保存済みなら出さない）
  if (!profile.prompt){ openModal(); }

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

  // ====== Scoring ======
  function topTags(n){ const arr = Object.entries(profile.tags||{}); arr.sort((a,b)=>b[1]-a[1]); return arr.slice(0,n); }
  function scoreByPref(title, text){
    const joined = (' '+String(title).toLowerCase()+' '+String(text).toLowerCase()+' ');
    let sc = 0;
    for (const [tag, w] of topTags(64)){
      const key = tag.startsWith('pref:') ? tag.slice(5) : (tag.startsWith('w:') ? tag.slice(2) : null);
      if (!key) continue;
      // シノニム辞書のキー一致なら加点、単語一致は弱く加点
      if (SYNS[key]){
        for (const k of SYNS[key]){ if (joined.includes(String(k).toLowerCase())){ sc += w; break; } }
      } else {
        if (joined.includes(key)) sc += w*0.5;
      }
    }
    return sc;
  }

  // 先読みバッファ
  const BUF_MAX = 6, CONCURRENCY = 3;
  const queue = []; let inflight = 0;

  function dedup(t){ return queue.some(x=>x.title===t); }

  async function fetchOneCandidate(){
    if (queue.length >= BUF_MAX || inflight >= CONCURRENCY) return;
    inflight++;
    try{
      // 最大5回まで候補を試し、最高スコアをpush
      let best=null, bs=-1e9;
      for (let tries=0; tries<5; tries++){
        let t, s;
        try{
          t = await getRandomTitle();
          if (dedup(t)) continue;
          s = await getSummary(t);
          if (!s.detail) continue;
          const sc = scoreByPref(s.title, s.detail);
          if (sc > bs){ bs=sc; best=s; }
        }catch(_){}
      }
      if (best) queue.push(best);
    }finally{
      inflight--;
      if (queue.length < BUF_MAX) fetchOneCandidate();
    }
  }
  function ensureBuffer(){ while (inflight < CONCURRENCY && queue.length < BUF_MAX) fetchOneCandidate(); }

  // 学習（MORE/OPEN）— 軽量
  function learnLight(text){ for (const t of tok(text)){ if (t.length>=2) bump('w:'+t, 0.2); } saveProfile(); }

  // 表示
  let current=null;
  function render(item){
    if (titleEl) titleEl.textContent = `【 ${item.title} 】`;
    const text = item.detail || '（説明なし）';
    if (blurbEl) blurbEl.textContent = text.length>1200 ? (text.slice(0,1200)+' …') : text;
    setStatus(''); showMain();
    ensureBuffer();
  }
  async function showOneInstant(){
    if (queue.length){ current = queue.shift(); render(current); return; }
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
  ensureBuffer(); setTimeout(()=>ensureBuffer(), 50); showOneInstant();

  // PWA
  (async () => {
    if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('./serviceWorker.js').then(reg=>{ try{ if(reg&&reg.update) reg.update(); }catch(e){} }); } catch(e){}
    }
  })();

})();