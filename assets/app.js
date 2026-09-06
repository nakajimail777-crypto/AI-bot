const $ = id => document.getElementById(id);
const input = $('messageInput'), send = $('sendButton'), messages = $('messages');
let db, session = null, activeId = null, busy = false, ready = false, epoch = 0, pending = null, rows = [], chats = [];
let historyOffset = 0, historyMore = false, olderMore = false;
let deleteTarget = null;
let archivedChats = [];
const storageKey = () => `dragon-draft-${session?.user.id || 'none'}`;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function toggleSidebar(open) { $('sidebar').classList.toggle('open', open); $('scrim').classList.toggle('show', open); }
function controls() {
  send.disabled = busy || !ready || !session || !input.value.trim();
  input.disabled = busy || !ready || !session;
  $('newChat').disabled = busy || !ready || !session;
  $('archiveChat').disabled = busy || !activeId;
  $('archiveChat').hidden = !activeId;
  $('deleteChat').hidden = !session || !activeId;
  $('deleteChat').disabled = busy || !ready;
  $('deleteAllChats').hidden = !session;
  $('deleteAllChats').disabled = busy || !ready;
  $('manageChats').hidden = !session;
  $('manageChats').disabled = busy || !ready;
  $('showArchivedChats').disabled = busy || !ready || !session;
  $('logout').disabled = busy;
  document.querySelectorAll('.history-item,.older,.archived-chat .plain-button').forEach(button => button.disabled = busy);
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight,160)+'px';
}
function rememberDraft() {
  if (!session) return;
  try { sessionStorage.setItem(storageKey(),JSON.stringify({ activeId, text:input.value, pending })); } catch {}
}
function renderMessages() {
  messages.replaceChildren();
  if (olderMore) {
    const button = document.createElement('button'); button.className='plain-button older'; button.textContent='前のメッセージを読む';
    button.onclick=() => run(() => loadMessages(true)); messages.append(button);
  }
  if (!rows.length) {
    const welcome=document.createElement('div'); welcome.className='welcome';
    const inner=document.createElement('div'); inner.className='welcome-inner';
    const h=document.createElement('h1'); h.textContent='心の声を、スピリットドラゴンに聞かせてください。';
    const p=document.createElement('p'); p.textContent=session?'会話は保存され、履歴からいつでも続けられます。':'ログインすると、会話を保存して続きから話せます。';
    inner.append(h,p); welcome.append(inner); messages.append(welcome);
  }
  for (const row of rows) {
    const block=document.createElement('div'); block.className=`message-row ${row.role}`;
    const text=document.createElement('div'); text.className=row.role==='user'?'bubble':'assistant-text'; text.textContent=row.content;
    if (row.role==='assistant') {
      const wrap=document.createElement('div'); wrap.className='assistant-message';
      const badge=document.createElement('div'); badge.className='assistant-badge'; badge.textContent='✦'; wrap.append(badge,text); block.append(wrap);
    } else block.append(text);
    messages.append(block);
  }
}
function renderHistory() {
  const nav=$('history'); nav.replaceChildren();
  for (const chat of chats) {
    const button=document.createElement('button'); button.className='history-item'+(chat.id===activeId?' active':''); button.textContent=chat.title;
    button.onclick=() => run(async()=>{ if(activeId!==chat.id){pending=null;input.value='';} activeId=chat.id; await loadMessages(); rememberDraft(); renderHistory(); toggleSidebar(false); });
    nav.append(button);
  }
  if (!chats.length) { const p=document.createElement('p'); p.className='history-empty'; p.textContent=session?'保存した会話がここに表示されます。':'ログインして会話を始めましょう。'; nav.append(p); }
  if(historyMore){const b=document.createElement('button');b.className='history-item';b.textContent='さらに表示';b.onclick=()=>run(()=>loadHistory(true));nav.append(b);}
  controls();
}
async function loadHistory(more=false) {
  const version=epoch;
  const from=more?historyOffset:0;
  const {data,error}=await db.from('conversations').select('id,title,updated_at').eq('user_id',session.user.id).is('archived_at',null).order('updated_at',{ascending:false}).order('id').range(from,from+29);
  if(error)throw new Error('履歴を読み込めませんでした。もう一度お試しください。');
  if(version!==epoch)return;
  chats=more?[...chats,...data]:data; historyOffset=from+data.length; historyMore=data.length===30; renderHistory();
}
async function loadMessages(older=false) {
  if(!activeId)return;
  const version=epoch, id=activeId;
  let query=db.from('messages').select('id,role,content,sequence').eq('conversation_id',id).order('sequence',{ascending:false}).limit(50);
  if(older&&rows.length)query=query.lt('sequence',rows[0].sequence);
  const {data,error}=await query;
  if(error)throw new Error('会話を読み込めませんでした。履歴を開き直してください。');
  if(version!==epoch||activeId!==id)return;
  rows=older?[...data.reverse(),...rows]:data.reverse();olderMore=data.length===50;renderMessages();
  if(!older)$('conversation').scrollTop=$('conversation').scrollHeight;
}
async function run(action) {
  if(busy || !ready)return;
  busy=true; controls();status('');
  try {await action();} catch(error){status(error.message||'通信できませんでした。もう一度お試しください。',true);} finally {busy=false;controls();}
}
async function changeSession(next) {
  const oldId=session?.user.id, nextId=next?.user.id;
  session=next;
  if(oldId===nextId){controls();return;}
  epoch++;const version=epoch;ready=false;activeId=null;rows=[];chats=[];pending=null;input.value='';historyMore=false;olderMore=false;
  deleteTarget=null;archivedChats=[];$('deleteDialog').close();$('manageDialog').close();$('archivedDialog').close();$('pdfDialog').close();$('pdfPreview').src='about:blank';
  $('profileName').textContent=session?.user.email||'ログイン'; $('profilePlan').textContent=session?'会話を保存できます':'メールでログイン';$('logout').hidden=!session;
  renderMessages();renderHistory();status('');
  if(!session){ready=true;controls();return;}
  $('authDialog').close();
  try {
    await loadHistory();
    if(version!==epoch)return;
    let draft;try{draft=JSON.parse(sessionStorage.getItem(storageKey())||'null');}catch{}
    if(draft){
      if(draft.activeId){
        const {data,error}=await db.from('conversations').select('id').eq('id',draft.activeId).is('archived_at',null).maybeSingle();
        if(error)throw error;
        if(version!==epoch)return;
        if(data){activeId=data.id;await loadMessages();}
      }
      if(!draft.activeId||activeId===draft.activeId){input.value=draft.text||'';pending=draft.pending||null;}
    }
    if(version!==epoch)return;
    renderHistory();
  }catch{if(version===epoch)status('履歴の読み込みに失敗しました。ページを再読み込みしてください。',true);}
  finally{if(version===epoch){ready=true;controls();}}
}
$('composer').addEventListener('submit',event=>{
  event.preventDefault();if(!session||busy||!input.value.trim())return;
  run(async()=>{
    const text=input.value.trim(), version=epoch;
    if(text.length>4000)throw new Error('メッセージは4,000文字以内で入力してください。');
    if(!activeId){
      const id=crypto.randomUUID();
      const {error}=await db.from('conversations').insert({id,title:text.slice(0,80),user_id:session.user.id});
      if(error)throw new Error('会話を作成できませんでした。もう一度お試しください。');
      activeId=id;rememberDraft();
    }
    if(!pending||pending.text!==text||pending.conversationId!==activeId)pending={requestId:crypto.randomUUID(),conversationId:activeId,text};
    rememberDraft();status('返答を考えています…');
    const {data:{session:fresh},error:authError}=await db.auth.getSession();
    if(authError||!fresh)throw new Error('ログインし直してください。');
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${fresh.access_token}`},body:JSON.stringify({message:text,conversationId:activeId,requestId:pending.requestId}),signal:AbortSignal.timeout(85000)});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'送信できませんでした。入力を残しています。');
    if(!data.saved)throw new Error('保存を確認できませんでした。もう一度お試しください。');
    if(version!==epoch)return;
    input.value='';pending=null;rememberDraft();status('保存しました');
    await loadMessages();await loadHistory();
  });
});
input.addEventListener('input',()=>{controls();rememberDraft();});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}});
$('newChat').onclick=()=>{if(busy)return;activeId=null;rows=[];pending=null;input.value='';olderMore=false;rememberDraft();renderMessages();renderHistory();status('');toggleSidebar(false);input.focus();};
$('archiveChat').onclick=()=>run(async()=>{
  if(!activeId)return;
  const {error}=await db.from('conversations').update({archived_at:new Date().toISOString()}).eq('id',activeId);
  if(error)throw new Error('会話を非表示にできませんでした。');
  activeId=null;rows=[];pending=null;input.value='';olderMore=false;rememberDraft();renderMessages();await loadHistory();status('会話を非表示にしました。');
});
$('profile').onclick=()=>{if(!session)$('authDialog').showModal();};
async function openDelete(all) {
  if(busy || !ready || !session || (!all && !activeId))return;
  const target={all,id:activeId,userId:session.user.id,version:epoch,count:null};
  deleteTarget=target;
  $('deleteTitle').textContent=all?'すべての会話を削除しますか？':'この会話を削除しますか？';
  $('deleteDescription').textContent='削除する会話の件数を確認しています…';
  $('confirmDelete').disabled=true;$('exportPdf').disabled=true;
  $('deleteStatus').textContent='';$('deleteDialog').showModal();
  try {
    let query=db.from('conversations').select('id',{count:'exact',head:true}).eq('user_id',target.userId);
    if(!all)query=query.eq('id',target.id);
    const {count,error}=await query;
    if(deleteTarget!==target || epoch!==target.version)return;
    if(error || !Number.isInteger(count) || count<0)throw new Error('件数を確認できませんでした。閉じてから、もう一度お試しください。');
    target.count=count;
    $('deleteDescription').textContent=count===0?'削除する会話はありません。':all
      ?`非表示にした会話も含め、保存した${count}件の会話と本文を削除します。元に戻せません。`
      :`${count}件の会話と本文を保存先から削除します。元に戻せません。`;
    $('confirmDelete').disabled=count===0;$('exportPdf').disabled=count===0;
  }catch(error){if(deleteTarget===target){$('deleteDescription').textContent='削除する件数を確認できていません。';$('deleteStatus').textContent=error.message;}}
}
$('deleteChat').onclick=()=>openDelete(false);
$('manageChats').onclick=()=>{if(!busy && ready && session){$('manageStatus').textContent='';$('manageDialog').showModal();}};
$('closeManage').onclick=()=>$('manageDialog').close();
function renderArchivedChats() {
  const list=$('archivedChats');list.replaceChildren();
  if(!archivedChats.length){const p=document.createElement('p');p.className='history-empty';p.textContent='非表示の会話はありません。';list.append(p);return;}
  for(const chat of archivedChats){
    const row=document.createElement('div');row.className='archived-chat';
    const title=document.createElement('span');title.className='archived-title';title.textContent=chat.title;
    const restore=document.createElement('button');restore.className='plain-button';restore.type='button';restore.textContent='再表示';restore.disabled=busy;
    restore.onclick=()=>run(async()=>{
      restore.disabled=true;$('archivedStatus').textContent='会話を一覧へ戻しています…';
      const {error}=await db.from('conversations').update({archived_at:null}).eq('id',chat.id).eq('user_id',session.user.id);
      if(error)throw new Error('会話を再表示できませんでした。もう一度お試しください。');
      archivedChats=archivedChats.filter(item=>item.id!==chat.id);renderArchivedChats();await loadHistory();$('archivedStatus').textContent='会話を一覧へ戻しました。';
    });
    row.append(title,restore);list.append(row);
  }
}
$('showArchivedChats').onclick=()=>run(async()=>{
  const version=epoch;$('manageStatus').textContent='非表示の会話を読み込んでいます…';
  const {data,error}=await db.from('conversations').select('id,title,updated_at,archived_at').eq('user_id',session.user.id).not('archived_at','is',null).order('archived_at',{ascending:false}).limit(100);
  if(error)throw new Error('非表示の会話を読み込めませんでした。もう一度お試しください。');
  if(version!==epoch)return;
  archivedChats=data||[];renderArchivedChats();$('manageStatus').textContent='';$('manageDialog').close();$('archivedDialog').showModal();
});
$('closeArchived').onclick=()=>{$('archivedDialog').close();if(session)$('manageDialog').showModal();};
$('archivedDialog').addEventListener('cancel',()=>{if(session)$('manageDialog').showModal();});
$('deleteAllChats').onclick=()=>{$('manageDialog').close();openDelete(true);};
$('cancelDelete').onclick=()=>{$('deleteDialog').close();deleteTarget=null;};
function exportConversationsPdf(fromManagement=false){return run(async()=>{
  const target=fromManagement?{all:true,id:null,userId:session?.user.id,version:epoch}:deleteTarget;
  const outputStatus=$(fromManagement?'manageStatus':'deleteStatus');
  if(!target || target.version!==epoch || target.userId!==session?.user.id)return;
  $('exportPdf').disabled=true;$('confirmDelete').disabled=true;$('cancelDelete').disabled=true;
  $('manageExportPdf').disabled=true;$('deleteAllChats').disabled=true;$('closeManage').disabled=true;
  outputStatus.textContent='PDF用に会話を読み込んでいます…';
  try {
    const exported=[];
    for(let offset=0;;offset+=100){
      let query=db.from('conversations').select('id,title').eq('user_id',target.userId).order('id').range(offset,offset+99);
      if(!target.all)query=query.eq('id',target.id);
      const {data,error}=await query;
      if(error || !Array.isArray(data))throw new Error('会話を読み込めませんでした。削除せずに、もう一度お試しください。');
      if(target.version!==epoch)return;
      for(const chat of data){
        const entries=[];
        for(let from=0;;from+=200){
          const result=await db.from('messages').select('role,content,sequence').eq('conversation_id',chat.id).order('sequence',{ascending:true}).range(from,from+199);
          if(result.error || !Array.isArray(result.data))throw new Error('本文を読み込めませんでした。削除せずに、もう一度お試しください。');
          if(target.version!==epoch)return;
          entries.push(...result.data);
          if(result.data.length<200)break;
        }
        exported.push({...chat,entries});
      }
      if(data.length<100)break;
    }
    if(!exported.length)throw new Error('保存できる会話がありません。');
    const doc=$('pdfPreview').contentDocument;
    doc.open();doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>スピリットドラゴンAI 会話</title><style>@page{size:A4;margin:18mm}body{font-family:"Yu Gothic",Meiryo,sans-serif;color:#222;background:#fff;font-size:11pt;line-height:1.8;padding:16px}h1{font-size:19pt}h2{font-size:15pt;overflow-wrap:anywhere}h3{font-size:11pt;margin-bottom:4px;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:0}section+section{break-before:page}.date{color:#666;font-size:9pt}@media print{body{padding:0}}</style></head><body></body></html>');doc.close();
    const heading=doc.createElement('h1');heading.textContent='スピリットドラゴンAI 会話';doc.body.append(heading);
    const date=doc.createElement('p');date.className='date';date.textContent='出力日時：'+new Date().toLocaleString('ja-JP');doc.body.append(date);
    for(const chat of exported){
      const section=doc.createElement('section'),title=doc.createElement('h2');title.textContent=chat.title;section.append(title);
      for(const entry of chat.entries){const role=doc.createElement('h3'),body=doc.createElement('p');role.textContent=entry.role==='user'?'あなた':'スピリットドラゴンAI';body.textContent=entry.content;section.append(role,body);}
      if(!chat.entries.length){const p=doc.createElement('p');p.textContent='この会話にはメッセージがありません。';section.append(p);}
      doc.body.append(section);
    }
    outputStatus.textContent='';$('closePdf').textContent=fromManagement?'会話の管理に戻る':'削除確認に戻る';$('pdfDialog').showModal();
  }catch(error){if(target.version===epoch)outputStatus.textContent=error.message;}
  finally{$('exportPdf').disabled=false;$('confirmDelete').disabled=false;$('cancelDelete').disabled=false;$('manageExportPdf').disabled=false;$('closeManage').disabled=false;}
});}
$('exportPdf').onclick=()=>exportConversationsPdf(false);
$('manageExportPdf').onclick=()=>exportConversationsPdf(true);
$('manageDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
$('printPdf').onclick=()=>{$('pdfPreview').contentWindow.focus();$('pdfPreview').contentWindow.print();};
$('closePdf').onclick=()=>{$('pdfDialog').close();$('pdfPreview').src='about:blank';};
$('pdfDialog').addEventListener('cancel',()=>{$('pdfPreview').src='about:blank';});
$('deleteDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else deleteTarget=null;});
$('confirmDelete').onclick=()=>run(async()=>{
  const target=deleteTarget;
  if(!target || !(target.count>0) || target.version!==epoch || target.userId!==session?.user.id)return;
  $('confirmDelete').disabled=true;$('cancelDelete').disabled=true;$('deleteStatus').textContent='削除しています…';
  try {
    const {error}=await db.rpc('delete_my_conversations',{p_conversation_id:target.all?null:target.id,p_delete_all:target.all});
    if(error)throw new Error('削除を確認できませんでした。時間をおいて、もう一度お試しください。');
    if(target.version!==epoch)return;
    activeId=null;rows=[];chats=[];pending=null;input.value='';olderMore=false;historyMore=false;historyOffset=0;
    try{sessionStorage.removeItem(storageKey());}catch{}
    renderMessages();renderHistory();deleteTarget=null;$('deleteDialog').close();toggleSidebar(false);
    status(target.all?'すべての会話を削除しました。':'会話を削除しました。');
    try{await loadHistory();}catch{status('削除は完了しました。残りの履歴はページを再読み込みして確認してください。');}
  }catch(error){if(target.version===epoch)$('deleteStatus').textContent=error.message;}
  finally{$('confirmDelete').disabled=false;$('cancelDelete').disabled=false;}
});
$('closeAuth').onclick=()=>$('authDialog').close();
$('googleLogin').onclick=async()=>{
  const button=$('googleLogin');button.disabled=true;$('authStatus').textContent='Googleを開いています…';
  try{
    if(!db)throw new Error('ログインの準備ができていません。');
    const {error}=await db.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'}});
    if(error)throw error;
  }catch{$('authStatus').textContent='Googleログインを開始できませんでした。もう一度お試しください。';button.disabled=false;}
};
$('authForm').onsubmit=async event=>{
  event.preventDefault();const button=$('loginSend');button.disabled=true;$('authStatus').textContent='送信しています…';
  try{
    if(!db)throw new Error('ログインの準備ができていません。');
    const {error}=await db.auth.signInWithOtp({email:$('email').value.trim(),options:{emailRedirectTo:location.origin+'/'}});
    if(error)throw new Error('メールを送れませんでした。時間をおいてお試しください。');
    $('authStatus').textContent='メール内のリンクを開いてください。届かない場合は迷惑メールもご確認ください。';
  }catch(error){$('authStatus').textContent=error.message;}finally{button.disabled=false;}
};
$('logout').onclick=()=>run(async()=>{
  const key=storageKey();const {error}=await db.auth.signOut({scope:'local'});
  if(error)throw new Error('ログアウトできませんでした。もう一度お試しください。');
  try{sessionStorage.removeItem(key);}catch{}
  await changeSession(null);
});
$('openSidebar').onclick=()=>toggleSidebar(true);$('closeSidebar').onclick=()=>toggleSidebar(false);$('scrim').onclick=()=>toggleSidebar(false);
async function start(){
  renderMessages();renderHistory();controls();
  try{
    const response=await fetch('/api/config',{cache:'no-store'});const config=await response.json();
    if(!response.ok)throw new Error(config.error);
    if(!window.supabase)throw new Error('ログイン機能を読み込めませんでした。ページを再読み込みしてください。');
    db=window.supabase.createClient(config.url,config.publishableKey);
    db.auth.onAuthStateChange((_event,next)=>{setTimeout(()=>changeSession(next),0);});
    const {data,error}=await db.auth.getSession();if(error)throw error;await changeSession(data.session);
  }catch(error){status(error.message||'ログイン機能を読み込めませんでした。',true);}
}
start();
