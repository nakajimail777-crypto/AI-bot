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
  async function api(action, params = {}, body) {
    if (!db) throw Error('ログイン機能を読み込めませんでした。ページを再読み込みしてください。');
    const {data, error} = await db.auth.getSession();
    if (error || !data.session || data.session.user.is_anonymous) {lock('管理者アカウントでログインしてください。');throw Error('ログインが必要です。');}
    if (state.userId && state.userId !== data.session.user.id) {lock('アカウントが変更されました。再確認してください。');throw Error('アカウントが変更されました。');}
    const response = await fetch(action === 'adopt_candidate' ? '/api/bookshelf-sync' : '/api/admin?' + new URLSearchParams({action,...params}), {
      method:body ? 'POST' : 'GET', body:body ? JSON.stringify(body) : undefined,
      headers:{Authorization:`Bearer ${data.session.access_token}`, ...(body ? {'Content-Type':'application/json'} : {})},cache:'no-store',signal:AbortSignal.timeout(['extract_candidate','adopt_candidate'].includes(action) ? 90000 : 25000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ([401,403].includes(response.status)) lock(result.error || '管理者としてログインしてください。');
      throw Object.assign(Error(result.error || '読み込めませんでした。再試行してください。'), {usage:result.usage});
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
        html = heading('対話から生まれた学びを、次の知識へ。', '<button id="refresh">更新</button>') + `<div class="stats">${[['学習候補','—','','候補の詳細から手動で抽出','✧'],['本棚登録',summary.books,'冊','取り出し済みの資料を除く','▤'],['最近の会話',summary.recentConversations,'件',`Web ${summary.webRecentConversations}件 · LINE ${summary.lineRecentConversations}件`,'▱']].map(s => `<article class="stat"><div class="stat-top">${s[0]}<span class="stat-icon">${s[4]}</span></div><div class="number">${s[1]}<small>${s[2]}</small></div><div class="stat-bottom">${s[3]}</div></article>`).join('')}</div><div class="grid"><section class="panel"><div class="panel-head"><h2>学習候補</h2><button class="text-button" data-page="candidates">画面を見る →</button></div><p class="empty">会話からの学びを、ここに集めます。</p><p class="hint">会話ログから候補を保存し、候補の詳細でAI抽出を試せます。保存前に人が確認します。</p></section><section class="panel"><div class="panel-head"><h2>知識の本棚</h2><button class="text-button" data-page="books">本棚を開く →</button></div>${bookRows(books.items.slice(0,3))}</section></div><section class="panel"><div class="panel-head"><h2>直近に更新されたWeb会話</h2><button class="text-button" data-page="logs">すべて見る →</button></div>${logTable(logs.items.slice(0,5))}</section><p class="hint">集計期間：${date(summary.since)} ～ ${date(summary.until)}（日本時間）。Webはアーカイブ済みを含みます。LINEは匿名化された利用者単位で、最大30日保持される直近20往復が対象です。お試し会話は含みません。</p>`;
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
        const result = await api('candidates',{offset:state.offset});
        if (version !== state.version) return;
        state.nextOffset = result.nextOffset;
        html = heading('会話ログから手動で保存した候補です。','<button id="refresh">更新</button>') + '<section class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>作成日時</th><th>会話本文の冒頭</th><th>状態</th><th>操作</th></tr></thead><tbody>' + result.items.map(item => `<tr><td>${date(item.created_at)}</td><td>${escapeHtml(item.original_text)}</td><td>${item.knowledge_documents?.metadata?.shelf_removed ? '取り出し済み' : item.bookshelf_document_id ? '本棚に登録済み' : '確認待ち'}</td><td><button data-candidate="${escapeHtml(item.id)}">全文・学びを編集</button></td></tr>`).join('') + '</tbody></table>' + (result.items.length ? '' : '<p class="empty">学習候補はまだありません。</p>') + '</div></section>' + pagination();
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
      if (target.action === 'candidate') {
        const item = result.candidate;
        target.savedText = item.learning_text || '';
        target.updatedAt = item.updated_at; target.adopted = Boolean(item.bookshelf_document_id) && !item.knowledge_documents?.metadata?.shelf_removed;
        $('dialogTitle').textContent = '学習候補の編集';
        $('dialogBody').innerHTML = '<p class="hint" id="candidateMeta"></p><h3>元の会話（全文）</h3><div class="message candidate-original"><p id="candidateOriginal"></p></div><div class="actions"><button id="extractLearning">この会話から学びを抽出</button></div><p class="hint">元会話をAIで分析します。結果は下書きです。確認・修正してから保存してください。抽出・保存だけでは本棚に入りません。採用するとAIの回答に使われます。</p><p id="extractionUsage" class="hint" role="status"></p><section id="extractionPreview" hidden><h3>抽出結果のプレビュー（未保存）</h3><div class="message"><p id="extractionText"></p></div><button id="applyExtraction">残したい学びに反映</button></section><label for="learningText">残したい学び</label><p class="hint" id="learningHelp">会話から残したい内容を自分の言葉でまとめてください。元の会話本文は変更されません。20,000文字以内。</p><textarea id="learningText" rows="8" maxlength="20000" aria-describedby="learningHelp"></textarea><div class="actions"><button id="saveLearning">学びを保存</button><button id="adoptLearning" class="primary">採用して本棚に入れる</button></div><p class="hint">採用前に、個人情報や会話固有の事情を除き、他の対話でも使える内容か確認してください。元の会話は本棚に登録しません。</p>';
        $('candidateMeta').textContent = '作成：' + date(item.created_at) + ' · 更新：' + date(item.updated_at);
        $('candidateOriginal').textContent = item.original_text;
        $('learningText').value = target.savedText;
        $('adoptLearning').disabled = target.adopted;
        if(item.knowledge_documents?.metadata?.shelf_removed)$('adoptLearning').textContent='もう一度本棚に入れる';
        if(target.adopted){$('adoptLearning').textContent='本棚に登録済み'; $('learningText').readOnly=true; $('saveLearning').disabled=true; $('extractLearning').disabled=true;}
        $('detailStatus').textContent = '';
        $('detailMore').hidden = true;
        return;
      }
      const record = result.conversation || result.document || result.lineConversation;
      $('dialogTitle').textContent = result.lineConversation ? `LINE利用者 ${record.user_hash.slice(0,8)}` : record.title || '無題';
      if (target.offset === 0) {
        $('dialogBody').replaceChildren();
        const meta = document.createElement('p');meta.className = 'hint';
        meta.textContent = result.lineConversation ? `${date(record.updated_at)} · 匿名化ID · 最大30日保持` : result.conversation ? `${date(record.updated_at)} · ${record.archived_at?'アーカイブ済み':'保存済み'} · ID: ${record.id}` : record.source_name;
        $('dialogBody').append(meta);
        if (result.conversation || result.lineConversation) {
          const future = document.createElement('div');future.className='actions';future.innerHTML='<button id="saveCandidate">学習候補に送る</button><span class="hint">会話本文を保存します。AI分析は行いません。</span><span id="candidateStatus" role="status"></span>';
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
  async function adoptLearning(button) {
    const target=detail,version=state.detailVersion;
    if(!target || target.saving || target.extracting || target.adopted) return;
    if(!$('learningText').value.trim() || $('learningText').value!==target.savedText) { $('detailStatus').textContent='先に「学びを保存」を押してください。'; return; }
    target.saving=true; button.disabled=true; $('saveLearning').disabled=true; $('extractLearning').disabled=true; $('learningText').readOnly=true;
    $('detailStatus').textContent='本棚に登録しています…';
    try {
      await api('adopt_candidate',{}, {candidateId:target.id,expected_updated_at:target.updatedAt});
      if(version!==state.detailVersion || !state.authorized)return;
      target.adopted=true; button.textContent='本棚に登録済み';
      $('detailStatus').textContent='採用した学びを本棚に入れました。AIが回答の参考にできます。';
      await renderPage();
    } catch(error) {if(version===state.detailVersion && state.authorized)$('detailStatus').textContent=error.message;}
    finally {target.saving=false;if(version===state.detailVersion && state.authorized){button.disabled=target.adopted;$('saveLearning').disabled=target.adopted;$('extractLearning').disabled=target.adopted;$('learningText').readOnly=target.adopted;}}
  }
  async function saveLearning(button) {
    const target = detail, version = state.detailVersion;
    if (!target || target.action !== 'candidate' || target.saving || target.extracting) return;
    const input = $('learningText'), text = input.value;
    target.saving = true; button.disabled = true; $('extractLearning').disabled = true;
    $('detailStatus').textContent = '保存しています…';
    try {
      const result = await api('update_candidate', {}, {id:target.id, learning_text:text, expected_updated_at:target.updatedAt});
      if (version !== state.detailVersion || !state.authorized) return;
      target.savedText = result.candidate.learning_text;
      target.updatedAt = result.candidate.updated_at;
      $('detailStatus').textContent = input.value === target.savedText ? '学びを保存しました。' : '送信した内容を保存しました。その後の変更は未保存です。';
    } catch(error) {
      if (version === state.detailVersion && state.authorized) $('detailStatus').textContent = error.message;
    } finally {
      target.saving = false;
      if (version === state.detailVersion && state.authorized) {button.disabled = false; $('extractLearning').disabled = false;}
    }
  }
  function showExtractionUsage(usage) {
    if (!usage) return;
    const n = value => Number.isFinite(value) ? value.toLocaleString('ja-JP') : '不明';
    $('extractionUsage').textContent = '入力 ' + n(usage.generation?.input) + ' / 出力 ' + n(usage.generation?.output) + ' トークン（思考分を含む） · 推定API料金 ' + (Number.isFinite(usage.estimatedUsd) ? '$' + usage.estimatedUsd.toFixed(6) : '不明') + '（既存単価による概算） · ' + (usage.recorded ? '利用ログ記録済み' : '利用ログは未記録') + ' · 記録ID: ' + (usage.eventIds?.join(', ') || 'なし');
  }
  async function extractLearning(button) {
    const target = detail, version = state.detailVersion;
    if (!target || target.action !== 'candidate' || target.extracting || target.saving) return;
    const input = $('learningText'), initialText = input.value;
    target.extracting = true; button.disabled = true; $('saveLearning').disabled = true;
    $('applyExtraction').disabled = true;
    $('detailStatus').textContent = '学びを抽出しています…（保存はしません）';
    $('extractionUsage').textContent = '';
    try {
      const result = await api('extract_candidate', {}, {id:target.id});
      if (version !== state.detailVersion || !state.authorized) return;
      showExtractionUsage(result.usage);
      if (result.noCandidate) {
        $('detailStatus').textContent = '学習候補なし。入力内容は変更していません。';
        return;
      }
      if (!input.value.trim() && input.value === initialText) {
        input.value = result.text; target.previewText = null; $('extractionPreview').hidden = true;
        $('detailStatus').textContent = '抽出結果を入力しました（未保存）。根拠を確認・修正して「学びを保存」を押してください。';
      } else {
        target.previewText = result.text;
        $('extractionText').textContent = result.text; $('extractionPreview').hidden = false;
        $('detailStatus').textContent = '入力内容を残し、抽出結果をプレビューに表示しました（未保存）。';
      }
    } catch (error) {
      if (version !== state.detailVersion || !state.authorized) return;
      showExtractionUsage(error.usage);
      $('detailStatus').textContent = error.message;
    } finally {
      target.extracting = false;
      if (version === state.detailVersion && state.authorized) {
        button.disabled = false; $('saveLearning').disabled = false; $('applyExtraction').disabled = false;
      }
    }
  }
  function applyExtraction() {
    if (!detail?.previewText || detail.extracting || detail.saving) return;
    if ($('learningText').value.trim() && !confirm('入力中の「残したい学び」を抽出結果で置き換えますか？まだ保存はされません。')) return;
    $('learningText').value = detail.previewText;
    detail.previewText = null; $('extractionPreview').hidden = true;
    $('detailStatus').textContent = '入力欄に反映しました（未保存）。確認・修正して「学びを保存」を押してください。';
  }
  function hasUnsavedLearning() {
    return detail?.action === 'candidate' && $('learningText') && ($('learningText').value !== detail.savedText || detail.saving || detail.extracting || detail.previewText);
  }
  function closeDetail() {
    if (hasUnsavedLearning() && !confirm('処理中、または未保存の学び・抽出プレビューがあります。閉じてもよいですか？')) return;
    $('detail').close();
  }
  async function saveCandidate(button) {
    const target = detail, version = state.detailVersion;
    if (!target || button.disabled) return;
    button.disabled = true;
    const status = $('candidateStatus');
    status.textContent = '保存しています…';
    try {
      await api('save_candidate',{}, {id:target.id, source:target.action === 'line_conversation' ? 'line' : 'web'});
      if (version !== state.detailVersion || !state.authorized) return;
      status.textContent = '学習候補に保存しました。';
      button.textContent = '保存済み';
    } catch(error) {
      if (version !== state.detailVersion || !state.authorized) return;
      status.textContent = error.message; button.disabled = false;
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
    if(button.dataset.candidate&&state.authorized)openDetail('candidate',button.dataset.candidate);
    if(button.id==='adoptLearning'&&state.authorized)adoptLearning(button);
    if(button.id==='saveLearning'&&state.authorized)saveLearning(button);
    if(button.id==='extractLearning'&&state.authorized)extractLearning(button);
    if(button.id==='applyExtraction'&&state.authorized)applyExtraction();
    if(button.dataset.book)openDetail('book',button.dataset.book);
    if(button.dataset.source&&state.page==='logs'){state.logSource=button.dataset.source;state.offset=0;renderPage();}
    if(button.id==='saveCandidate'&&state.authorized)saveCandidate(button);
    if(button.id==='refresh')renderPage();
    if(button.id==='next'&&state.nextOffset!==null){state.offset=state.nextOffset;renderPage();}
    if(button.id==='previous'){state.offset=Math.max(0,state.offset-25);renderPage();}
  });
  $('closeDialog').onclick=closeDetail;
  $('detail').addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
  window.addEventListener('beforeunload',event=>{if(hasUnsavedLearning()){event.preventDefault();event.returnValue='';}});
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
