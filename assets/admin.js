(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const titles = {dashboard:'ダッシュボード', books:'知識の本棚', candidates:'学習候補', logs:'会話ログ'};
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '日時不明';
  const state = {page:'dashboard',logSource:'web',offset:0,nextOffset:null,version:0,detailVersion:0,authorized:false,userId:null};
  let db, authCheck = 0, detail = null;
  function lock(message) {
    state.authorized = false;
    state.version++;
    state.detailVersion++;
    state.userId = null;
    detail = null;
    $('workspace').hidden = true;
    $('view').replaceChildren();
    $('dialogBody').replaceChildren();
    $('dialogTitle').textContent = '';
    $('detailStatus').textContent = '';
    $('detail').close();
    $('gate').hidden = false;
    $('gateStatus').textContent = message;
  }
  async function api(action, params = {}) {
    if (!db) throw Error('ログイン機能を読み込めませんでした。ページを再読み込みしてください。');
    const {data, error} = await db.auth.getSession();
    if (error || !data.session || data.session.user.is_anonymous) {lock('管理者アカウントでログインしてください。');throw Error('ログインが必要です。');}
    if (state.userId && state.userId !== data.session.user.id) {lock('アカウントが変更されました。再確認してください。');throw Error('アカウントが変更されました。');}
    const response = await fetch('/api/admin?' + new URLSearchParams({action,...params}), {
      headers:{Authorization:`Bearer ${data.session.access_token}`},cache:'no-store',signal:AbortSignal.timeout(25000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ([401,403].includes(response.status)) lock(result.error || '管理者としてログインしてください。');
      throw Error(result.error || '読み込めませんでした。再試行してください。');
    }
    return result;
  }
  const heading = (description, extra = '') => `<div class="heading"><div><h1>${titles[state.page]}</h1><p class="sub">${description}</p></div>${extra}</div>`;
  const shelfLink = '<a class="button primary" href="/rag-register.html" target="_blank" rel="noopener">本棚の登録・編集 ↗</a>';
  const pagination = () => `<div class="actions"><button id="previous" ${state.offset === 0?'disabled':''}>前の25件</button><span class="hint">${state.offset + 1}件目から表示</span><button id="next" ${state.nextOffset === null?'disabled':''}>次の25件</button></div>`;
  const logTable = items => `<div class="table-wrap"><table class="table"><thead><tr><th>会話</th><th>最終更新（日本時間）</th><th>状態</th><th>操作</th></tr></thead><tbody>${items.map(c => `<tr><td>${escapeHtml(c.title || '無題の会話')}</td><td>${date(c.updated_at)}</td><td><span class="pill">${c.archived_at?'アーカイブ':'保存済み'}</span></td><td><button data-chat="${escapeHtml(c.id)}">詳細を見る ↗</button></td></tr>`).join('')}</tbody></table>${items.length?'':'<p class="empty">保存された会話はありません。</p>'}</div>`;
  const lineLogTable = items => `<div class="table-wrap"><table class="table"><thead><tr><th>会話</th><th>最終更新（日本時間）</th><th>保持</th><th>操作</th></tr></thead><tbody>${items.map(c => `<tr><td>LINE利用者 ${escapeHtml(c.user_hash.slice(0,8))}</td><td>${date(c.updated_at)}</td><td><span class="pill gold">最大30日</span></td><td><button data-line-chat="${escapeHtml(c.user_hash)}">詳細を見る ↗</button></td></tr>`).join('')}</tbody></table>${items.length?'':'<p class="empty">保持中のLINE会話はありません。</p>'}</div>`;
  const sourceTabs = () => `<div class="source-tabs" role="tablist" aria-label="会話の種類"><button role="tab" data-source="web" aria-selected="${state.logSource==='web'}">Web会話</button><button role="tab" data-source="line" aria-selected="${state.logSource==='line'}">LINE会話</button></div>`;
  function bookRows(items) {
    return items.map(book => `<div class="row"><div class="small-book"><span class="book-icon">≋</span><div><strong>${escapeHtml(book.title)}</strong><p>${escapeHtml(book.source_name)} · ${date(book.updated_at)}</p></div></div><div class="actions" style="margin:0"><span class="pill ${book.metadata?.shelf_removed?'gold':''}">${book.metadata?.shelf_removed?'取り出し済み':'利用可能'}</span><button data-book="${escapeHtml(book.id)}">内容を確認</button></div></div>`).join('') || '<p class="empty">本棚にはまだ資料がありません。</p>';
  }
  async function renderPage() {
    if (!state.authorized) return;
    const version = ++state.version, page = state.page;
    $('breadcrumb').textContent = titles[page];
    document.querySelectorAll('nav button').forEach(b => {if(b.dataset.page === page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('pageStatus').textContent = '';
    $('view').innerHTML = heading('読み込んでいます…');
    try {
      let html;
      if (page === 'dashboard') {
        const [summary, books, logs] = await Promise.all([api('summary'),api('books'),api('conversations')]);
        html = heading('対話から生まれた学びを、次の知識へ。', '<button id="refresh">更新</button>') + `<div class="stats">${[['学習候補','—','','抽出機能は準備中','✧'],['本棚登録',summary.books,'冊','取り出し済みの資料を除く','▤'],['最近の会話',summary.recentConversations,'件',`Web ${summary.webRecentConversations}件 · LINE ${summary.lineRecentConversations}件`,'▱']].map(s => `<article class="stat"><div class="stat-top">${s[0]}<span class="stat-icon">${s[4]}</span></div><div class="number">${s[1]}<small>${s[2]}</small></div><div class="stat-bottom">${s[3]}</div></article>`).join('')}</div><div class="grid"><section class="panel"><div class="panel-head"><h2>学習候補</h2><button class="text-button" data-page="candidates">画面を見る →</button></div><p class="empty">会話からの学びを、ここに集めます。</p><p class="hint">初期版は画面のみです。候補の抽出・保存はまだ行われません。</p></section><section class="panel"><div class="panel-head"><h2>知識の本棚</h2><button class="text-button" data-page="books">本棚を開く →</button></div>${bookRows(books.items.slice(0,3))}</section></div><section class="panel"><div class="panel-head"><h2>直近に更新されたWeb会話</h2><button class="text-button" data-page="logs">すべて見る →</button></div>${logTable(logs.items.slice(0,5))}</section><p class="hint">集計期間：${date(summary.since)} ～ ${date(summary.until)}（日本時間）。Webはアーカイブ済みを含みます。LINEは匿名化された利用者単位で、最大30日保持される直近20往復が対象です。お試し会話は含みません。</p>`;
      } else if (page === 'books') {
        const result = await api('books',{offset:state.offset});
        if (version !== state.version) return;
        state.nextOffset = result.nextOffset;
        html = heading('AIが回答の参考にする、既存のRAG資料を確認できます。',shelfLink) + `<p class="hint">登録・差し替え・取り出しは既存の本棚画面で行えます。管理用の合言葉が必要です。</p><section class="panel">${bookRows(result.items)}</section>${pagination()}`;
      } else if (page === 'logs') {
        const line = state.logSource === 'line';
        const result = await api(line?'line_conversations':'conversations',{offset:state.offset});
        if (version !== state.version) return;
        state.nextOffset = result.nextOffset;
        html = heading('保存された会話を振り返り、学びの背景を確認します。','<button id="refresh">更新</button>') + sourceTabs() + `<p class="hint">${line?'匿名化された利用者ID · 直近20往復 · 最大30日保持':'更新順 · アーカイブ済みを含む会員の会話'}</p><section class="panel">${line?lineLogTable(result.items):logTable(result.items)}</section>${pagination()}`;
      } else {
        html = heading('会話から得られた学びを確認し、本棚に残すものを選びます。') + `<section class="panel"><div class="panel-head"><h2>学習候補</h2><span class="pill gold">準備中</span></div><p class="hint">初期版はUIのみです。以下は項目の見本で、実際の候補ではありません。</p><article class="candidate"><label>学び</label><h3>会話から得られた学びが入ります</h3><label>理由</label><p>学びとして残す理由と、元会話の背景を表示します。</p><label>再利用性</label><span class="pill">未評価</span><div class="actions"><button disabled class="source">元会話を見る ↗</button><button disabled>捨てる</button><button disabled class="primary">＋ 本棚に追加</button></div></article></section>`;
      }
      if (version !== state.version || !state.authorized) return;
      $('view').innerHTML = html;
    } catch(error) {
      if (version !== state.version || !state.authorized) return;
      $('view').innerHTML = heading('') + '<button id="refresh">再試行</button>';
      $('pageStatus').textContent = error.message;
    }
  }
  async function loadDetail() {
    const version = state.detailVersion, target = detail;
    if (!target || target.busy) return;
    target.busy = true;
    $('detailMore').disabled = true;
    $('detailStatus').textContent = '読み込んでいます…';
    try {
      const result = await api(target.action,{id:target.id,offset:target.offset});
      if (version !== state.detailVersion || !state.authorized) return;
      const record = result.conversation || result.document || result.lineConversation;
      $('dialogTitle').textContent = result.lineConversation ? `LINE利用者 ${record.user_hash.slice(0,8)}` : record.title || '無題';
      if (target.offset === 0) {
        $('dialogBody').replaceChildren();
        const meta = document.createElement('p');meta.className = 'hint';
        meta.textContent = result.lineConversation ? `${date(record.updated_at)} · 匿名化ID · 最大30日保持` : result.conversation ? `${date(record.updated_at)} · ${record.archived_at?'アーカイブ済み':'保存済み'} · ID: ${record.id}` : record.source_name;
        $('dialogBody').append(meta);
        if (result.conversation || result.lineConversation) {
          const future = document.createElement('div');future.className='actions';future.innerHTML='<button disabled>✧ この会話から学びを抽出</button><span class="hint">今後追加予定</span>';
          $('dialogBody').append(future);
        }
      }
      for (const item of result.items) {
        const block=document.createElement('div');block.className='message'+(item.role==='user'?' user':'');
        if(item.role){const role=document.createElement('small');role.textContent={user:'ユーザー',assistant:'スピリットドラゴン',system:'システム'}[item.role]||item.role;block.append(role);}
        const text=document.createElement('p');text.textContent=item.content;block.append(text);$('dialogBody').append(block);
      }
      if (!result.items.length && target.offset === 0) $('detailStatus').textContent = target.action === 'book' ? '保存された本文はありません。取り出し済みの資料は元のファイルを入れ直してください。' : '保存されたメッセージはありません。';
      else $('detailStatus').textContent = '';
      target.offset = result.nextOffset;
      $('detailMore').textContent = '続きを読む';
      $('detailMore').hidden = result.nextOffset === null;
    } catch(error) {
      if(version !== state.detailVersion || !state.authorized)return;
      $('detailStatus').textContent=error.message;
      $('detailMore').textContent='再試行';$('detailMore').hidden=false;
    } finally {
      target.busy=false;
      if(version===state.detailVersion)$('detailMore').disabled=false;
    }
  }
  function openDetail(action,id) {
    state.detailVersion++;
    detail={action,id,offset:0,busy:false};
    $('dialogTitle').textContent='読み込み中';$('dialogBody').replaceChildren();$('detailMore').hidden=true;
    $('detail').showModal();loadDetail();
  }
  async function authorize() {
    const check=++authCheck;
    lock('管理者権限を確認しています…');
    $('retryAuth').disabled=true;
    try {
      if(!db)throw Error('ログイン機能の読み込みに失敗しました。ページを再読み込みしてください。');
      const {data,error}=await db.auth.getSession();
      if(error||!data.session)throw Error('ユーザー画面でログインしてから、再確認してください。');
      state.userId=data.session.user.id;
      await api('summary');
      if(check!==authCheck)return;
      state.authorized=true;$('gate').hidden=true;$('workspace').hidden=false;
      state.offset=0;await renderPage();
    } catch(error){if(check===authCheck)lock(error.message);}
    finally {if(check===authCheck)$('retryAuth').disabled=false;}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.page&&state.authorized){state.page=button.dataset.page;state.offset=0;renderPage();}
    if(button.dataset.chat)openDetail('conversation',button.dataset.chat);
    if(button.dataset.lineChat)openDetail('line_conversation',button.dataset.lineChat);
    if(button.dataset.book)openDetail('book',button.dataset.book);
    if(button.dataset.source&&state.page==='logs'){state.logSource=button.dataset.source;state.offset=0;renderPage();}
    if(button.id==='refresh')renderPage();
    if(button.id==='next'&&state.nextOffset!==null){state.offset=state.nextOffset;renderPage();}
    if(button.id==='previous'){state.offset=Math.max(0,state.offset-25);renderPage();}
  });
  $('closeDialog').onclick=()=>$('detail').close();
  $('detail').onclose=()=>{state.detailVersion++;detail=null;$('dialogBody').replaceChildren();};
  $('detailMore').onclick=loadDetail;
  $('retryAuth').onclick=authorize;
  $('logout').onclick=async()=>{
    authCheck++;lock('ログアウトしています…');
    try {const {error}=await db.auth.signOut({scope:'local'});if(error)throw error;lock('ログアウトしました。');}
    catch{lock('ログアウトできませんでした。再確認して、もう一度ログアウトしてください。');}
  };
  async function start() {
    try {
      const response=await fetch('/api/config',{cache:'no-store'});const config=await response.json();
      if(!response.ok)throw Error(config.error||'接続設定が必要です。');
      if(!window.supabase)throw Error('ログイン機能を読み込めませんでした。ページを再読み込みしてください。');
      db=window.supabase.createClient(config.url,config.publishableKey);
      db.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_OUT'||(state.userId&&session?.user.id!==state.userId)){
          authCheck++;lock('ログイン状態が変更されました。再確認してください。');$('retryAuth').disabled=false;
        }
      });
      await authorize();
    } catch(error){lock(error.message);}
  }
  start();
})();
