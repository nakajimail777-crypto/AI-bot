const $ = id => document.getElementById(id);
const input = $('messageInput'), send = $('sendButton'), messages = $('messages');
let db, session = null, activeId = null, busy = false, ready = false, epoch = 0, pending = null, rows = [], chats = [];
let historyOffset = 0, historyMore = false, olderMore = false;
const storageKey = () => `dragon-draft-${session?.user.id || 'none'}`;
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function toggleSidebar(open) { $('sidebar').classList.toggle('open', open); $('scrim').classList.toggle('show', open); }
function controls() {
  send.disabled = busy || !ready || !session || !input.value.trim();
  input.disabled = busy || !ready || !session;
  $('newChat').disabled = busy || !ready || !session;
  $('archiveChat').disabled = busy || !activeId;
  $('logout').disabled = busy;
  document.querySelectorAll('.history-item,.older').forEach(button => button.disabled = busy);
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
$('closeAuth').onclick=()=>$('authDialog').close();
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
