const $ = id => document.getElementById(id);
const input = $('messageInput'), send = $('sendButton'), messages = $('messages');
let db, session = null, activeId = null, busy = false, ready = false, epoch = 0, pending = null, rows = [], chats = [];
let historyOffset = 0, historyMore = false, olderMore = false;
let trialRemaining=5, trialReady=false, trialPending=null, trialLoading=null;
async function loadTrial(){
 if(trialLoading?.version===epoch)return trialLoading.promise;
 const version=epoch;
 const promise=readTrial(version);
 trialLoading={version,promise};
 try{return await promise;}finally{if(trialLoading?.promise===promise)trialLoading=null;}
}
async function readTrial(version){
 const response=await fetch('/api/guest-chat',{cache:'no-store'});
 const data=await response.json();
 if(version!==epoch||session)return;
 if(!response.ok)throw new Error(data.error||'お試し会話を読み込めませんでした。');
 rows=data.rows||[];trialRemaining=data.remaining;trialReady=true;
 renderMessages();renderHistory();controls();
}
async function sendTrial(){
 if(!trialReady||trialRemaining<=0){$('authDialog').showModal();return;}
 const text=input.value.trim(),version=epoch;
 if(text.length>4000)throw new Error('メッセージは4,000文字以内で入力してください。');
 if(!trialPending||trialPending.text!==text||trialPending.mode!==seikanMode)trialPending={text,mode:seikanMode,id:crypto.randomUUID()};
 status('返答を考えています…');
 const response=await fetch('/api/guest-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,requestId:trialPending.id,seikanMode}),signal:AbortSignal.timeout(85000)});
 const data=await response.json();
 if(version!==epoch||session)return;
 if(!response.ok){
  if(['TRIAL_LIMIT','TRIAL_ATTEMPTS','TRIAL_NETWORK_LIMIT'].includes(data.code)){trialRemaining=0;$('authDialog').showModal();}
  throw new Error(data.error||'送信できませんでした。入力は残っています。');
 }
 trialRemaining=data.remaining;input.value='';trialPending=null;
 await loadTrial();
 $('conversation').scrollTop=$('conversation').scrollHeight;
 status(trialRemaining>0?'あと'+trialRemaining+'回お試しいただけます。':'5往復のお試しが終わりました。ログインすると新しい会話を始められます。');
}
let deleteTarget = null;
let seikanMode = false;
$('seikanMode').onclick=()=>{
  if(busy)return;
  seikanMode=!seikanMode;pending=null;rememberDraft();controls();
  status(seikanMode?'静観モードに切り替えました。次の送信から、今ここで起きていることを一緒に見ていきます。':'通常モードに戻しました。次の送信から適用します。');
};
let archivedChats = [];
let pdfDownloadUrl=null;
function clearPdfDownload(){
  if(pdfDownloadUrl){const previous=pdfDownloadUrl;setTimeout(()=>URL.revokeObjectURL(previous),60000);pdfDownloadUrl=null;}
  $('printPdf').removeAttribute('href');
}
let usageVersion = 0, usageCache = new Map(), cooldownUntil = 0;
let attachedPdf = null, pdfReading = false, pdfVersion = 0;
function clearPdf() {
  pdfVersion++; attachedPdf=null; pdfReading=false;
  $('pdfInput').value=''; $('pdfAttachment').hidden=true; $('pdfName').textContent='';
}
const storageKey = () => `dragon-draft-${session?.user.id || 'none'}`;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function toggleSidebar(open) { $('sidebar').classList.toggle('open', open); $('scrim').classList.toggle('show', open); }
function controls() {
  $('seikanMode').disabled = busy || !ready || (!session&&!trialReady);
  $('seikanMode').setAttribute('aria-pressed',String(seikanMode));
  $('seikanMode').textContent = seikanMode?'静観モード：ON':'静観モード：OFF';
  $('seikanHint').hidden = !seikanMode;
  send.disabled = busy || pdfReading || !ready || (!session&&(!trialReady||trialRemaining<=0)) || (!input.value.trim() && !attachedPdf) || Date.now() < cooldownUntil;
  $('attachPdf').disabled = busy || pdfReading || !ready || !session;
  $('removePdf').disabled = busy;
  send.title = Date.now() < cooldownUntil ? `あと約${Math.ceil((cooldownUntil-Date.now())/1000)}秒で送信できます` : '';
  $('openUsage').hidden = !session;
  input.disabled = busy || !ready || (!session&&(!trialReady||trialRemaining<=0));
  $('trialBanner').hidden=!!session;
  $('trialCount').textContent=trialRemaining>0?'ログインなしであと'+trialRemaining+'回お試しできます。':'お試しは終了しました。ログインして新しい会話を始めましょう。';
  $('newChat').disabled = busy || !ready || !session;
  $('archiveChat').disabled = busy || !activeId;
  $('archiveChat').hidden = !activeId;
  $('copyChat').hidden = !session || !activeId;
  $('copyChat').disabled = busy || !ready || !rows.length;
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
  try { sessionStorage.setItem(storageKey(),JSON.stringify({ activeId, text:input.value, pending, cooldownUntil, seikanMode })); } catch {}
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
    const p=document.createElement('p'); p.textContent=session?'会話は保存され、履歴からいつでも続けられます。':'ログインせずに5往復までお話しできます。静観モードもお試しください。';
    inner.append(h,p); welcome.append(inner); messages.append(welcome);
  }
  for (const row of rows) {
    const block=document.createElement('div'); block.className=`message-row ${row.role}`;
    const text=document.createElement('div'); text.className=row.role==='user'?'bubble':'assistant-text'; text.textContent=row.content;
    if (row.role==='assistant') {
      const wrap=document.createElement('div'); wrap.className='assistant-message';
      const badge=document.createElement('div'); badge.className='assistant-badge'; badge.textContent='✦';
      const content=document.createElement('div'); content.className='assistant-content';
      const detail=document.createElement('details'); detail.className='answer-usage'; detail.dataset.requestId=row.reply_to || '';
      const title=document.createElement('summary'); title.textContent='トークン数・推定料金';
      detail.hidden=!session;
      const stats=document.createElement('p'); stats.textContent=DragonUsage.answer(usageCache.get(row.reply_to));
      detail.append(title,stats); content.append(text,detail); wrap.append(badge,content); block.append(wrap);
    } else block.append(text);
    messages.append(block);
  }
}
function renderHistory() {
  const nav=$('history'); nav.replaceChildren();
  for (const chat of chats) {
    const button=document.createElement('button'); button.className='history-item'+(chat.id===activeId?' active':''); button.textContent=chat.title;
    button.onclick=() => run(async()=>{ if(activeId!==chat.id){clearPdf();pending=null;input.value='';} activeId=chat.id; await loadMessages(); rememberDraft(); renderHistory(); toggleSidebar(false); });
    nav.append(button);
  }
  if (!chats.length) { const p=document.createElement('p'); p.className='history-empty'; p.textContent=session?'保存した会話がここに表示されます。':'お試しは右の入力欄から。ログイン後は保存した会話がここに表示されます。'; nav.append(p); }
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
  let query=db.from('messages').select('id,role,content,sequence,reply_to').eq('conversation_id',id).order('sequence',{ascending:false}).limit(50);
  if(older&&rows.length)query=query.lt('sequence',rows[0].sequence);
  const {data,error}=await query;
  if(error)throw new Error('会話を読み込めませんでした。履歴を開き直してください。');
  if(version!==epoch||activeId!==id)return;
  rows=older?[...data.reverse(),...rows]:data.reverse();olderMore=data.length===50;renderMessages();
  if(!older)$('conversation').scrollTop=$('conversation').scrollHeight;
  void refreshUsage();
}
async function run(action) {
  if(busy || !ready)return;
  busy=true; controls();status('');
  try {await action();} catch(error){status(error.message||'通信できませんでした。もう一度お試しください。',true);} finally {busy=false;controls();}
}
async function changeSession(next) {
  const oldId=session?.user.id, nextId=next?.user.id;
  session=next;
  if(oldId!==nextId)seikanMode=false;
  if(oldId===nextId){if(!next){ready=true;try{await loadTrial();}catch(error){status(error.message,true);}}controls();return;}
  epoch++;const version=epoch;clearPdf();ready=false;activeId=null;rows=[];chats=[];pending=null;input.value='';historyMore=false;olderMore=false;
  usageVersion++; usageCache.clear(); cooldownUntil=0; $('usageDialog').close(); $('usageScope').value='self'; $('usageScopeLabel').hidden=true; $('usageMonthly').textContent='';
  clearPdfDownload();deleteTarget=null;archivedChats=[];$('deleteDialog').close();$('manageDialog').close();$('archivedDialog').close();$('pdfDialog').close();$('pdfPreview').src='about:blank';
  $('profileName').textContent=session?.user.email||'ログイン'; $('profilePlan').textContent=session?'会話を保存できます':'メールでログイン';$('logout').hidden=!session;
  renderMessages();renderHistory();status('');
  if(!session){ready=true;trialReady=false;try{await loadTrial();}catch(error){status(error.message,true);}controls();return;}
  $('authDialog').close();
  try {
    await loadHistory();
    if(version!==epoch)return;
    let draft;try{draft=JSON.parse(sessionStorage.getItem(storageKey())||'null');}catch{}
    if(draft){
      seikanMode=draft.seikanMode===true;
      cooldownUntil=Number.isFinite(draft.cooldownUntil)?Math.min(draft.cooldownUntil,Date.now()+86400000):0;
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
  event.preventDefault();if(busy||pdfReading||(!input.value.trim()&&!attachedPdf)||Date.now()<cooldownUntil)return;
  run(async()=>{
    if(!session){await sendTrial();return;}
    const text=input.value.trim() || '添付したPDFの内容を要約してください。', version=epoch;
    const attachment=attachedPdf;
    if(attachment && `${text}\n\n［添付PDF：${attachment.name}］`.length>4000)throw new Error('PDFのファイル名を含めて4,000文字以内になるよう、質問を短くしてください。');
    if(text.length>4000)throw new Error('メッセージは4,000文字以内で入力してください。');
    if(!activeId){
      const id=crypto.randomUUID();
      const {error}=await db.from('conversations').insert({id,title:text.slice(0,80),user_id:session.user.id});
      if(error)throw new Error('会話を作成できませんでした。もう一度お試しください。');
      activeId=id;rememberDraft();
    }
    if(!pending||pending.text!==text||pending.conversationId!==activeId||pending.pdfId!==attachment?.id||pending.seikanMode!==seikanMode)pending={requestId:crypto.randomUUID(),conversationId:activeId,text,pdfId:attachment?.id,seikanMode};
    rememberDraft();status('返答を考えています…');
    const {data:{session:fresh},error:authError}=await db.auth.getSession();
    if(authError||!fresh)throw new Error('ログインし直してください。');
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${fresh.access_token}`},body:JSON.stringify({message:text,conversationId:activeId,requestId:pending.requestId,seikanMode,...(attachment?{attachment:{name:attachment.name,mimeType:'application/pdf',data:attachment.data}}:{})}),signal:AbortSignal.timeout(85000)});
    const data=await response.json().catch(()=>({}));
    if(version!==epoch)return;
    if(!response.ok) {
      if(response.status===429 && Number.isFinite(data.retryAfterSeconds) && data.retryAfterSeconds>0) {
        cooldownUntil=Date.now()+Math.min(data.retryAfterSeconds,86400)*1000;
      }
      rememberDraft();
      throw new Error(data.error||(response.status===429?'今はAIを利用できません。少し時間をおいてお試しください。入力した内容は残っています。':'送信できませんでした。入力を残しています。'));
    }
    if(!data.saved)throw new Error('保存を確認できませんでした。もう一度お試しください。');
    if(version!==epoch)return;
    if(data.usage)usageCache.set(pending.requestId,data.usage);
    input.value='';pending=null;rememberDraft();status('保存しました');
    await loadMessages();await loadHistory();
  });
});
input.addEventListener('input',()=>{controls();rememberDraft();});
$('attachPdf').onclick=()=>{if(!busy&&!pdfReading&&ready&&session)$('pdfInput').click();};
$('removePdf').onclick=()=>{if(!busy){clearPdf();pending=null;rememberDraft();controls();status('PDFを外しました。');}};
$('pdfInput').addEventListener('change',async()=>{
  const file=$('pdfInput').files[0];if(!file)return;
  if(busy||!ready||!session)return;
  const version=++pdfVersion, userEpoch=epoch, chatId=activeId;
  pdfReading=true;controls();status('PDFを読み込んでいます…');
  try {
    if(!/\.pdf$/i.test(file.name)||file.name.length>160||/[\x00-\x1f\x7f]/.test(file.name))throw new Error('PDFファイルを選んでください（ファイル名は160文字まで）。');
    if(!file.size||file.size>3*1024*1024)throw new Error('PDFは3MB以下のファイルを選んでください。');
    const header=await file.slice(0,5).text();
    if(header!=='%PDF-')throw new Error('PDFを読み取れません。正しいPDFファイルを選び直してください。');
    const data=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('PDFを読み込めませんでした。もう一度選んでください。'));
      reader.readAsDataURL(file);
    });
    if(version!==pdfVersion||userEpoch!==epoch||chatId!==activeId)return;
    attachedPdf={id:crypto.randomUUID(),name:file.name.trim(),data};pending=null;
    const sizeLabel=file.size<1024*1024?`${Math.max(1,Math.ceil(file.size/1024))}KB`:`${(file.size/1024/1024).toFixed(2)}MB`;
    $('pdfName').textContent=`PDF：${attachedPdf.name}（${sizeLabel}）`;
    $('pdfAttachment').hidden=false;rememberDraft();status('PDFを添付しました。質問を入力して送信してください。');
  }catch(error){if(version===pdfVersion)status(error.message,true);}
  finally{if(version===pdfVersion){pdfReading=false;$('pdfInput').value='';controls();}}
});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}});
$('newChat').onclick=()=>{if(busy)return;clearPdf();activeId=null;rows=[];pending=null;input.value='';olderMore=false;rememberDraft();renderMessages();renderHistory();status('');toggleSidebar(false);input.focus();};
$('archiveChat').onclick=()=>run(async()=>{
  if(!activeId)return;
  const {error}=await db.from('conversations').update({archived_at:new Date().toISOString()}).eq('id',activeId);
  if(error)throw new Error('会話を非表示にできませんでした。');
  clearPdf();activeId=null;rows=[];pending=null;input.value='';olderMore=false;rememberDraft();renderMessages();await loadHistory();status('会話を非表示にしました。');
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
$('copyChat').onclick=()=>run(async()=>{
  if(!session || !activeId)return;
  const version=epoch, id=activeId, copied=[];
  status('会話をコピーしています…');
  for(let from=0;;from+=200){
    const {data,error}=await db.from('messages').select('role,content,sequence')
      .eq('conversation_id',id).order('sequence',{ascending:true}).range(from,from+199);
    if(version!==epoch || activeId!==id)return;
    if(error)throw new Error('会話を読み込めませんでした。もう一度コピーしてください。');
    copied.push(...data);
    if(data.length<200)break;
  }
  if(!copied.length)throw new Error('コピーする会話がありません。');
  const text=copied.map(row=>`${row.role==='user'?'あなた':'スピリットドラゴンAI'}\n${row.content}`).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field=document.createElement('textarea'), previous=document.activeElement;
    field.value=text;field.setAttribute('readonly','');
    field.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(field);
    try {
      field.select();
      if(!document.execCommand('copy'))throw new Error('コピーできませんでした。ブラウザのクリップボード権限を確認して、もう一度お試しください。');
    } finally {field.remove();previous?.focus();}
  }
  status('会話をコピーしました');
});
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
async function refreshUsage() {
  if(!session)return;
  const version=++usageVersion, userEpoch=epoch, conversation=activeId;
  const ids=[...new Set(rows.filter(row=>row.role==='assistant'&&row.reply_to).map(row=>row.reply_to))];
  const month=$('usageMonth').value || new Date(Date.now()+9*3600000).toISOString().slice(0,7);
  $('usageMonth').value=month;
  if($('usageDialog').open)$('usageMonthly').textContent='集計しています…';
  try {
    const {data:{session:fresh}}=await db.auth.getSession();
    if(!fresh)throw new Error('ログインし直してください。');
    // Read receipts in pages as older messages are loaded; never truncate at 50.
    const chunks=ids.length?Array.from({length:Math.ceil(ids.length/50)},(_,i)=>ids.slice(i*50,i*50+50)):[[]];
    let result;
    for(const chunk of chunks) {
      const params=new URLSearchParams({month,scope:$('usageScope').value,requestIds:chunk.join(',')});
      const r=await fetch('/api/usage?'+params,{headers:{Authorization:`Bearer ${fresh.access_token}`},signal:AbortSignal.timeout(10000)});
      const data=await r.json();if(!r.ok)throw new Error(data.error);
      if(version!==usageVersion||userEpoch!==epoch||conversation!==activeId)return;
      for(const turn of data.turns || [])usageCache.set(turn.request_id,turn.usage);
      result=data;
    }
    $('usageScopeLabel').hidden=!result.admin;
    $('usageMonthly').textContent=DragonUsage.monthly(result);
    document.querySelectorAll('.answer-usage').forEach(detail=>{detail.querySelector('p').textContent=DragonUsage.answer(usageCache.get(detail.dataset.requestId));});
  }catch(error){if(version===usageVersion&&userEpoch===epoch)$('usageMonthly').textContent=error.message||'使用量を取得できませんでした。会話は続けられます。';}
}
$('openUsage').onclick=()=>{$('usageDialog').showModal();void refreshUsage();};
$('closeUsage').onclick=()=>$('usageDialog').close();
$('refreshUsage').onclick=()=>void refreshUsage();
$('usageMonth').onchange=()=>void refreshUsage();
$('usageScope').onchange=()=>void refreshUsage();
setInterval(()=>{if(cooldownUntil){if(Date.now()>=cooldownUntil)cooldownUntil=0;controls();}},1000);
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
    outputStatus.textContent='PDFファイルを作成しています…';
    clearPdfDownload();
    const pdfBytes=await DragonPdf.create(exported);
    if(target.version!==epoch)return;
    pdfDownloadUrl=URL.createObjectURL(new Blob([pdfBytes],{type:'application/pdf'}));
    $('printPdf').href=pdfDownloadUrl;
    $('printPdf').download=`spirit-dragon-chat-${new Date().toISOString().replace(/[:.]/g,'-')}.pdf`;
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
$('closePdf').onclick=()=>{clearPdfDownload();$('pdfDialog').close();$('pdfPreview').src='about:blank';};
$('pdfDialog').addEventListener('cancel',()=>{clearPdfDownload();$('pdfPreview').src='about:blank';});
$('deleteDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();else deleteTarget=null;});
$('confirmDelete').onclick=()=>run(async()=>{
  const target=deleteTarget;
  if(!target || !(target.count>0) || target.version!==epoch || target.userId!==session?.user.id)return;
  $('confirmDelete').disabled=true;$('cancelDelete').disabled=true;$('deleteStatus').textContent='削除しています…';
  try {
    const {error}=await db.rpc('delete_my_conversations',{p_conversation_id:target.all?null:target.id,p_delete_all:target.all});
    if(error)throw new Error('削除を確認できませんでした。時間をおいて、もう一度お試しください。');
    if(target.version!==epoch)return;
    clearPdf();activeId=null;rows=[];chats=[];pending=null;input.value='';olderMore=false;historyMore=false;historyOffset=0;
    try{sessionStorage.removeItem(storageKey());}catch{}
    renderMessages();renderHistory();deleteTarget=null;$('deleteDialog').close();toggleSidebar(false);
    status(target.all?'すべての会話を削除しました。':'会話を削除しました。');
    try{await loadHistory();}catch{status('削除は完了しました。残りの履歴はページを再読み込みして確認してください。');}
  }catch(error){if(target.version===epoch)$('deleteStatus').textContent=error.message;}
  finally{$('confirmDelete').disabled=false;$('cancelDelete').disabled=false;}
});
$('trialLogin').onclick=()=>$('authDialog').showModal();
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
