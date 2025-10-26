const output = document.getElementById('output');
const detailBtn = document.getElementById('detailBtn');
let currentConcept = null;
function typeWriter(text, i=0, callback){ if(i<text.length){ output.textContent+=text.charAt(i); setTimeout(()=>typeWriter(text,i+1,callback),50); } else if(callback) callback(); }
let gptModel=null;
async function initModel(){ gptModel = await GPT4All.load('./gpt4all/gpt4all.wasm'); }
async function generateConcept(){ if(!gptModel) return;
const prompt = `あなたは「知のセイレーン」です。ユーザーに偶然性のある概念を提示してください。
形式：- title: 短い概念名 - blurb: 1行の説明 - detail: 詳細説明`; 
const result = await gptModel.generate(prompt,{max_tokens:150});
try { currentConcept = JSON.parse(result); } catch { currentConcept = {title:"セレンディピティ", blurb:"意図しない探求の果てに、思わぬ発見がある。", detail:"偶然の発見や予期せぬ出会いが知を広げる現象。"} }
output.textContent="";
typeWriter(`今日の概念：${currentConcept.title}

──${currentConcept.blurb}`); }
detailBtn.addEventListener('click',()=>{ if(currentConcept) output.textContent+=`

[詳細]
${currentConcept.detail}`; });
initModel().then(()=>{ generateConcept(); setInterval(generateConcept,20000); });
if('serviceWorker' in navigator){ navigator.serviceWorker.register('./serviceWorker.js').then(()=>console.log('Service Worker registered')); }