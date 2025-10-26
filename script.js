// ====== DOM取得 ======
const $ = (sel) => document.querySelector(sel);
const titleEl   = $('#title');
const blurbEl   = $('#blurb');
const altViewEl = $('#altview');

const genreSel  = $('#genreSel');
const nextBtn   = $('#nextBtn');
const moreBtn   = $('#detailBtn');
const relatedBtn= $('#relatedBtn');
const openBtn   = $('#openBtn');
const clearBtn  = $('#clearBtn');
const backBtn   = $('#backBtn');

// ====== 状態 ======
let idx = 0;
const seeds = [
  { t:'AIの阿頼耶識', b:'心的表象と確率的更新についてメモ' },
  { t:'ノイズからの形', b:'S字の“なだらかさ”を保つ遷移' },
  { t:'テルミンUI', b:'ロール/ピッチの連続性を担保' },
];

function setMain(t, b) {
  if (titleEl) titleEl.textContent = t || '（無題）';
  if (blurbEl) blurbEl.textContent = b || '';
}

// 現在タイトル取得（WIKI/RELATEDで使用）
function currentQuery() {
  const t = (titleEl?.textContent || '').trim();
  return t || (genreSel?.value || 'トピック');
}

// 初期化（起動中→最初の項目に差し替え）
function boot() {
  setMain(seeds[0].t, seeds[0].b);
  if (altViewEl) altViewEl.hidden = true;
  if (backBtn) backBtn.hidden = true;
}

// ====== ボタン挙動 ======
// NEXT: ダミーで配列を巡回（実アプリのロジックに置換可）
nextBtn?.addEventListener('click', () => {
  idx = (idx + 1) % seeds.length;
  setMain(seeds[idx].t, seeds[idx].b);
});

// MORE: 補助表示をトグル
moreBtn?.addEventListener('click', () => {
  if (!altViewEl || !backBtn) return;
  if (altViewEl.hidden) {
    altViewEl.innerHTML = `<div class="blurb">詳細: 「${currentQuery()}」の補足情報（ダミー）</div>`;
    altViewEl.hidden = false;
    backBtn.hidden = false;
  } else {
    altViewEl.hidden = true;
    backBtn.hidden = true;
  }
});

// RELATED: 現在タイトル＋ジャンルでWeb検索
relatedBtn?.addEventListener('click', () => {
  const q = encodeURIComponent(`${currentQuery()} ${genreSel?.value || ''} 関連`);
  const url = `https://www.google.com/search?q=${q}`;
  window.open(url, '_blank', 'noopener');
});

// OPEN WIKI: 現在タイトルで日本語Wikipedia検索を開く
openBtn?.addEventListener('click', () => {
  const q = encodeURIComponent(currentQuery());
  const url = `https://ja.wikipedia.org/w/index.php?search=${q}`;
  window.open(url, '_blank', 'noopener');
});

// CLEAR: 画面を初期状態に
clearBtn?.addEventListener('click', () => {
  setMain('起動中…', '読み込み中');
  if (altViewEl) altViewEl.hidden = true;
  if (backBtn) backBtn.hidden = true;
  idx = 0;
});

// BACK: MORE表示から戻る
backBtn?.addEventListener('click', () => {
  if (altViewEl) altViewEl.hidden = true;
  if (backBtn) backBtn.hidden = true;
});

// 起動
document.addEventListener('DOMContentLoaded', boot);
