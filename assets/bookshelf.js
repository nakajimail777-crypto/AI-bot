const $=id=>document.getElementById(id);
let secret='', selected=null, replaceId=null, busy=false, documents=[];
async function api(action,extra={}) {
 const r=await fetch('/api/bookshelf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:secret,action,...extra})});
 const data=await r.json().catch(()=>({error:'通信結果を読み取れませんでした。'}));
 if(!r.ok)throw new Error(data.error||'処理できませんでした。');return data;
}
function lock(value){busy=value;document.querySelectorAll('button:not(#closeContent),input').forEach(el=>el.disabled=value);$('save').disabled=value||!selected;}
function reset(){selected=null;replaceId=null;$('file').value='';$('selection').textContent='ファイルが選ばれていません';$('uploadTitle').textContent='資料を追加する';$('details').hidden=true;$('preview').textContent='';$('cancel').hidden=true;$('save').disabled=true;}
async function run(fn){if(busy)return;lock(true);try{await fn();}catch(e){$('status').textContent=e.message;}finally{lock(false);}}
async function refresh(){const data=await api('list');documents=data.documents||[];render();}
function render(){
 $('books').replaceChildren();$('count').textContent=`（${documents.filter(x=>!x.metadata?.shelf_removed).length}冊）`;
 if(!documents.length){$('books').textContent='本棚はまだ空です。最初の資料をしまってみましょう。';return;}
 for(const doc of documents){const card=document.createElement('article');card.className='book';const tag=document.createElement('span');tag.className='tag'+(doc.metadata?.shelf_removed?' muted':'');tag.textContent=doc.metadata?.shelf_removed?'取り出し済み':'利用可能';const title=document.createElement('h3');title.textContent=doc.title;const meta=document.createElement('p');meta.textContent=`${doc.source_name} · ${new Date(doc.updated_at).toLocaleDateString('ja-JP')}`;const actions=document.createElement('div');actions.className='row';const change=document.createElement('button');change.className='secondary';change.textContent=doc.metadata?.shelf_removed?'入れ直す':'差し替える';change.onclick=()=>{reset();replaceId=doc.id;$('uploadTitle').textContent=`「${doc.title}」を差し替える`;$('cancel').hidden=false;$('file').focus();$('drop').scrollIntoView({behavior:'smooth',block:'center'});};actions.append(change);
 if(!doc.metadata?.shelf_removed){const remove=document.createElement('button');remove.className='secondary';remove.textContent='取り出す';remove.onclick=()=>{if(!confirm(`「${doc.title}」をAIの検索対象から外しますか？\n再び使うには元のファイルを入れ直してください。`))return;run(async()=>{$('status').textContent='取り出しています…';const data=await api('remove',{id:doc.id});reset();await refresh();$('status').textContent=data.message;});};actions.append(remove);}
 const view=document.createElement('button');view.className='secondary';view.textContent='内容を確認する';view.onclick=()=>run(async()=>{await showContent(doc);});actions.append(view);
 card.append(tag,title,meta,actions);$('books').append(card);
 }
}
async function showContent(doc){
 const dialog=$('contentDialog');$('contentTitle').textContent=doc.title;$('contentSource').textContent=doc.source_name;$('storedContent').textContent='読み込んでいます…';dialog.showModal();
 try{const data=await api('read',{id:doc.id});$('storedContent').textContent=data.content||'保存された本文がありません。取り出し済みの資料は、元のファイルを入れ直すと確認できます。';}
 catch(error){$('storedContent').textContent=error.message;}
}
$('closeContent').onclick=()=>$('contentDialog').close();
async function choose(files){if(busy)return;if(files.length!==1){$('status').textContent='1ファイルずつ選んでください。';return;}const f=files[0];selected=null;$('save').disabled=true;$('details').hidden=true;
 if(!/\.md$/i.test(f.name)||f.size>160000){$('status').textContent='.mdファイル（40,000文字まで）を選んでください。';return;}
 const text=await f.text();if(!text.trim()||text.length>40000){$('status').textContent='本文は1〜40,000文字にしてください。';return;}
 selected={name:f.name,content:text};$('selection').textContent=`${f.name} · ${text.length.toLocaleString()}文字`;$('preview').textContent=text;$('details').hidden=false;$('save').disabled=false;$('status').textContent='内容を確認して「本棚にしまう」を押してください。';}
$('login').onsubmit=e=>{e.preventDefault();secret=$('token').value;run(async()=>{$('status').textContent='本棚を開いています…';await refresh();$('unlock').hidden=true;$('shelf').hidden=false;$('token').value='';$('status').textContent='本棚を開きました。';});};
$('file').onchange=e=>choose(e.target.files);
$('drop').ondragover=e=>{e.preventDefault();if(!busy)$('drop').classList.add('over');};$('drop').ondragleave=()=>$('drop').classList.remove('over');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('over');choose(e.dataTransfer.files);};
$('cancel').onclick=reset;
$('refresh').onclick=()=>run(async()=>{await refresh();$('status').textContent='一覧を更新しました。';});
$('save').onclick=()=>{if(!selected)return;if(!replaceId&&documents.some(d=>d.source_name===selected.name)){ $('status').textContent='同名の資料があります。一覧の「差し替える」または「入れ直す」を使ってください。';return; }run(async()=>{$('status').textContent='登録中です。検索用のデータを作っています…';const data=await api('save',{...selected,...(replaceId?{id:replaceId}:{})});reset();await refresh();$('status').textContent=data.message;});};
