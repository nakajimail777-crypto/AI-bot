// User-operated progress storage. AI can only prepare a chat draft.
globalThis.DragonAyumi = {
  normalize(value) {
    const title = String(value.title || '').trim();
    if (!title || title.length > 120) throw new Error('目標名を1〜120文字で入力してください。');
    const due_date = value.due_date || null;
    if (due_date && (!/^\d{4}-\d{2}-\d{2}$/.test(due_date) || !Number.isFinite(Date.parse(due_date)) || new Date(due_date).toISOString().slice(0,10) !== due_date)) throw new Error('期限の日付を確認してください。');
    if (!Array.isArray(value.items) || value.items.length > 100) throw new Error('チェックリストは100件までです。');
    const ids = new Set();
    const items = value.items.map(item => {
      const text = String(item.text || '').trim();
      if (!text || text.length > 300 || typeof item.id !== 'string' || !item.id || item.id.length > 80 || ids.has(item.id) || typeof item.done !== 'boolean') throw new Error('各項目を1〜300文字で入力してください。');
      ids.add(item.id);
      return {id:item.id, text, done:item.done, ...this.weekFields(item)};
    });
    const insight = String(value.insight || '').trim();
    if (insight.length > 500) throw new Error('今日の気づきは500文字までです。');
    const deleted_items = value.deleted_items || [];
    if (!Array.isArray(deleted_items) || deleted_items.length>100) throw new Error('保管できる削除項目は100件までです。不要な項目を完全に削除してください。');
    const trash = deleted_items.map(entry=>{
      const item=entry.item;
      if(!item || typeof item.id!=='string' || !item.id || item.id.length>80 || ids.has(item.id) || typeof item.text!=='string' || item.text.length>300 || typeof item.done!=='boolean' || !Number.isInteger(entry.index) || entry.index<0 || entry.index>99 || !this.validDate(entry.deleted_on))throw new Error('削除した項目の形式を確認してください。');
      ids.add(item.id);
      return {item:{id:item.id,text:item.text,done:item.done,...this.weekFields(item)},index:entry.index,deleted_on:entry.deleted_on};
    });
    const insight_history=value.insight_history||[];
    if(!Array.isArray(insight_history)||insight_history.length>500)throw new Error('気づきの履歴は500件までです。');
    const noteIds=new Set();
    const history=insight_history.map(entry=>{
      if(typeof entry.id!=='string'||!entry.id||entry.id.length>80||noteIds.has(entry.id)||typeof entry.text!=='string'||!entry.text.trim()||entry.text.length>500||(entry.date!==null&&!this.validDate(entry.date)))throw new Error('気づきの履歴の形式を確認してください。');
      noteIds.add(entry.id);return {id:entry.id,date:entry.date,text:entry.text};
    });
    return {title, due_date, items, insight, deleted_items:trash, insight_history:history};
  },
  weekFields(item){
    if(item.weeks===undefined)return {};
    if(!Array.isArray(item.weeks)||item.weeks.length>104)throw new Error('週のチェックは各項目104週までです。');
    let previous='';
    const weeks=item.weeks.map(w=>{
      if(!this.validDate(w.start)||typeof w.done!=='boolean'||(previous&&w.start<this.addDays(previous,7)))throw new Error('週の開始日を確認してください。');
      previous=w.start;return {start:w.start,done:w.done};
    });
    return {weeks};
  },
  addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);},
  units(items){return items.flatMap(i=>i.weeks?.length?i.weeks:[i]);},
  validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;},
  today(){const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;},
  hydrate(value){
    const copy=structuredClone(value);
    copy.deleted_items??=[];copy.insight_history??=[];
    if(copy.insight?.trim()&&!copy.insight_history.length)copy.insight_history.push({id:`legacy-${copy.id}`,date:null,text:copy.insight});
    return copy;
  },
  withInsight(value,previous){
    const next=this.hydrate(value), text=String(value.insight||'').trim();
    // Only a changed, nonempty observation is appended on the explicit Save action.
    // Old undated observations are preserved without inventing a historical date.
    next.insight_history=structuredClone(previous.insight_history||[]);
    if(previous.insight?.trim()&&!next.insight_history.length)next.insight_history.push({id:`legacy-${previous.id}`,date:null,text:previous.insight});
    if(text&&text!==String(previous.insight||'').trim())next.insight_history.push({id:crypto.randomUUID(),date:this.today(),text});
    next.insight=text;return next;
  },
  progress(items) {
    const units=this.units(items), total = units.length, done = units.filter(item => item.done === true).length;
    return {done, total, percent:total ? Math.round(done / total * 100) : 0};
  },
  async user(db, owner) {
    const {data,error} = await db.auth.getUser();
    if (error || !data?.user || data.user.is_anonymous || data.user.id !== owner) throw new Error('保存・再表示にはログインが必要です。');
  },
  async list(db, owner) {
    await this.user(db, owner);
    const all = [];
    for (let offset = 0;; offset += 100) {
      const {data,error} = await db.from('ayumi_projects').select('*').eq('user_id',owner).order('id').range(offset,offset+99);
      if (error || !Array.isArray(data)) throw new Error('歩みを読み込めませんでした。接続と設定をご確認ください。');
      all.push(...data);
      if (data.length < 100) return all;
    }
  },
  async save(db, owner, project) {
    const payload = this.normalize(project);
    await this.user(db, owner);
    let query = db.from('ayumi_projects');
    query = project.version == null
      ? query.insert({id:project.id, ...payload})
      : query.update({...payload, version:project.version+1}).eq('id',project.id).eq('user_id',owner).eq('version',project.version);
    const {data,error} = await query.select('*').maybeSingle();
    if (!error && data) return data;
    // If a response was lost, a repeated Save is successful only for identical data.
    const current = await db.from('ayumi_projects').select('*').eq('id',project.id).eq('user_id',owner).maybeSingle();
    if (!current.error && current.data && JSON.stringify(this.normalize(current.data)) === JSON.stringify(payload)) return current.data;
    if ((!error && !data) || error?.code === '23505') throw new Error('別の画面で更新されています。入力を控えてから一覧を再読み込みしてください。');
    throw new Error('保存できませんでした。入力は残っています。接続を確認して再度保存してください。');
  },
  prompt(project, reflect) {
    const p = this.normalize(project), count = this.progress(p.items);
    return `${reflect ? 'この歩みを一緒に振り返ってください。成果だけでなく気づきも大切にしてください。' : 'この目標を無理のない小さな行動に分ける案をください。'}\n進捗の遅れを責めず、完璧な達成を求めないでください。チェックを完了したと判断したり、保存したと伝えたりしないでください。提案の採用と完了チェックは私が決めます。\n目標：${p.title}\n期限：${p.due_date || '設定なし'}\n歩み：${count.done}/${count.total}\n${p.items.map(i=>`${i.weeks?.length?'':i.done?'☑':'☐'} ${i.text}${(i.weeks||[]).map(w=>`\n  ${w.done?'☑':'☐'} ${w.start}〜${this.addDays(w.start,6)}`).join('')}`).join('\n')}\n今日の気づき：${p.insight || 'まだ記入していません'}${reflect?'\n最近の気づき（最大5件）：\n'+p.insight_history.slice(-5).map(n=>`${n.date||'日付未記録'}：${n.text}`).join('\n'):''}`;
  },
  mount({context, prepareChat}) {
    const el = id => document.getElementById(id), dialog = el('ayumiDialog');
    const expanded=new Set();
    let projects = [], draft = null, dirty = false, generation = 0, loading = false;
    const message = text => { el('ayumiStatus').textContent = text; };
    const canSave = () => { const c=context(); return c.db && c.session && !c.session.user.is_anonymous; };
    const fresh = () => ({id:crypto.randomUUID(),title:'',due_date:null,items:[],insight:'',deleted_items:[],insight_history:[]});
    function saveState(){
      el('ayumiDirty').textContent=loading?'処理中…':dirty?'未保存':draft?.version?'保存済み':'まだ保存していません';
      el('ayumiDirty').dataset.dirty=String(dirty);
      el('ayumiSave').disabled=loading||!canSave();
      el('ayumiSave').textContent=loading?'処理中…':'保存';
    }
    const changed = () => { dirty=true;saveState(); message('未保存の変更があります。「保存」で記録できます。'); };
    const read = () => ({...draft,title:el('ayumiName').value,due_date:el('ayumiDue').value||null,insight:el('ayumiInsight').value});
    const planner=globalThis.DragonAyumiPlanner?.mount({context,apply(plan){
      if(loading||!discard())return false;
      draft={...fresh(),title:plan.title,items:plan.items};dirty=true;render();
      message('案から新しい目標を作成しました。まだ保存していません。');
      el('ayumiName').focus();return true;
    }});
    function progress() {
      const p=DragonAyumi.progress(draft.items);
      el('ayumiCount').textContent=`${p.done} / ${p.total} 完了 · ${p.percent}%`;
      el('ayumiProgress').value=p.percent;
    }
    function renderItems() {
      el('ayumiItems').replaceChildren();
      draft.items.forEach((item,index)=>{
        const card=document.createElement('details');card.className='ayumi-card';card.open=expanded.has(item.id);
        card.ontoggle=()=>{if(!card.isConnected)return;if(card.open)expanded.add(item.id);else expanded.delete(item.id);};
        const summary=document.createElement('summary');
        const updateSummary=()=>{const p=DragonAyumi.progress([item]);summary.textContent=(item.text||'新しい一歩')+' · '+p.done+'/'+p.total;};
        updateSummary();card.append(summary);
        const row=document.createElement('div'); row.className='ayumi-item';
        const check=document.createElement('input'); check.type='checkbox'; check.checked=item.done; check.setAttribute('aria-label',`項目${index+1}の完了`);
        check.hidden=!!item.weeks?.length;
        check.onchange=()=>{item.done=check.checked;changed();progress();updateSummary();};
        const text=document.createElement('input'); text.type='text'; text.maxLength=300; text.value=item.text; text.placeholder='小さな一歩を書いてみましょう'; text.setAttribute('aria-label',`項目${index+1}`);
        text.oninput=()=>{item.text=text.value;changed();updateSummary();};
        const remove=document.createElement('button');remove.type='button';remove.textContent='削除';remove.className='plain-button';remove.setAttribute('aria-label',`項目${index+1}を削除`);
        remove.onclick=()=>{
          if(draft.deleted_items.length>=100){message('削除項目の保管は100件までです。保管一覧から不要な項目を完全に削除してください。');return;}
          draft.deleted_items.push({item:structuredClone(item),index,deleted_on:DragonAyumi.today()});
          draft.items.splice(index,1);changed();renderItems();
          message('項目を削除しました。「削除を元に戻す」で復元できます。');
        };
        const actions=document.createElement('div');actions.className='ayumi-item-actions';
        for(const [label,offset] of [['上へ',-1],['下へ',1]]){
          const move=document.createElement('button');move.type='button';move.className='plain-button';move.textContent=offset<0?'↑':'↓';move.title=label;
          move.setAttribute('aria-label',`項目${index+1}を${label}`);
          move.disabled=index+offset<0||index+offset>=draft.items.length;
          move.onclick=()=>{
            const next=index+offset;
            [draft.items[index],draft.items[next]]=[draft.items[next],draft.items[index]];
            changed();renderItems();
            el('ayumiItems').children[next].querySelector('input[type=text]').focus();
          };
          actions.append(move);
        }
        actions.append(remove);row.append(check,text,actions);card.append(row);
        const weekly=document.createElement('div');weekly.className='ayumi-weekly';
        const hint=document.createElement('p');hint.textContent='週ごとに記録する場合は開始日を選んで追加します。チェックは自分で付け、保存してください。';weekly.append(hint);
        for(const week of item.weeks||[]){
          const label=document.createElement('label');label.className='ayumi-week';
          const box=document.createElement('input');box.type='checkbox';box.checked=week.done;
          const caption=document.createElement('span');caption.textContent=week.start+' 〜 '+DragonAyumi.addDays(week.start,6);
          box.onchange=()=>{week.done=box.checked;changed();progress();updateSummary();};
          label.append(box,caption);weekly.append(label);
        }
        const start=document.createElement('input');start.type='date';start.setAttribute('aria-label','項目'+(index+1)+'の週の開始日');
        start.value=item.weeks?.length?DragonAyumi.addDays(item.weeks.at(-1).start,7):DragonAyumi.today();
        const add=document.createElement('button');add.type='button';add.className='plain-button';add.textContent='＋ 1週間を追加';
        add.onclick=()=>{
          if(!DragonAyumi.validDate(start.value)){message('週の開始日を選んでください。');return;}
          const weeks=[...(item.weeks||[]),{start:start.value,done:false}];
          try{DragonAyumi.weekFields({weeks});}catch(error){message(error.message);return;}
          if(!item.weeks?.length&&item.done&&!confirm('週ごとの記録に切り替えると、この項目の進捗は新しい週のチェックで計算します。切り替えますか？'))return;
          item.weeks=weeks;expanded.add(item.id);changed();renderItems();
        };
        weekly.append(start,add);card.append(weekly);el('ayumiItems').append(card);
      });
      progress();
      const history=draft.deleted_items;
      el('ayumiUndo').disabled=!history.length;
      el('ayumiUndo').textContent=history.length?`削除を元に戻す（${history.length}件）`:'削除を元に戻す';
      renderTrash();
    }
    function restore(index){
      if(draft.items.length>=100){message('項目は100件までです。空きを作ってから復元してください。');return;}
      const [entry]=draft.deleted_items.splice(index,1);if(!entry)return;
      draft.items.splice(Math.min(entry.index,draft.items.length),0,entry.item);
      changed();renderItems();message('項目を復元しました。「保存」で記録できます。');
    }
    function renderTrash(){
      el('ayumiTrashCount').textContent=`削除した項目（${draft.deleted_items.length}件）`;
      el('ayumiTrashList').replaceChildren();
      draft.deleted_items.forEach((entry,index)=>{
        const row=document.createElement('div');row.className='ayumi-record';
        const text=document.createElement('p');text.textContent=`${entry.deleted_on} · ${entry.item.done?'完了済み · ':''}${entry.item.text||'（空の項目）'}`;
        const restoreButton=document.createElement('button');restoreButton.type='button';restoreButton.className='plain-button';restoreButton.textContent='復元';restoreButton.onclick=()=>restore(index);
        const purge=document.createElement('button');purge.type='button';purge.className='plain-button';purge.textContent='完全に削除';
        purge.onclick=()=>{if(!confirm('この項目を保管一覧から完全に削除しますか？保存後は元に戻せません。'))return;draft.deleted_items.splice(index,1);changed();renderItems();};
        row.append(text,restoreButton,purge);el('ayumiTrashList').append(row);
      });
    }
    function renderInsights(){
      el('ayumiInsightCount').textContent=`気づきの履歴（${draft.insight_history.length}件）`;
      el('ayumiInsightList').replaceChildren();
      for(const note of [...draft.insight_history].reverse()){
        const row=document.createElement('div');row.className='ayumi-record';
        const date=document.createElement('small');date.textContent=note.date||'日付未記録（以前の気づき）';
        const text=document.createElement('p');text.textContent=note.text;
        row.append(date,text);el('ayumiInsightList').append(row);
      }
    }
    function render() {
      draft=DragonAyumi.hydrate(draft);
      el('ayumiName').value=draft.title;el('ayumiDue').value=draft.due_date||'';el('ayumiInsight').value=draft.insight;
      el('ayumiSave').disabled=!canSave();
      el('ayumiGuest').hidden=!!canSave();
      renderItems();
      renderInsights();saveState();
    }
    const discard = () => !dirty || confirm('未保存の変更を破棄しますか？');
    function renderList() {
      el('ayumiList').replaceChildren();
      for(const project of projects){
        const button=document.createElement('button');button.type='button';button.className='plain-button';
        const p=DragonAyumi.progress(project.items);button.textContent=`${project.title}（${p.done}/${p.total}）`;
        button.onclick=()=>{if(loading||!discard())return;draft=structuredClone(project);dirty=false;render();message('保存した歩みを開きました。');};
        el('ayumiList').append(button);
      }
    }
    async function load() {
      if(loading || !discard())return;
      if(!canSave()){message('ログインすると、保存した歩みを再表示できます。');return;}
      const g=++generation,c=context();loading=true;saveState();el('ayumiFields').disabled=true;message('読み込み中…');
      try{
        const result=await DragonAyumi.list(c.db,c.session.user.id);
        if(g!==generation)return;
        projects=result;dirty=false;draft=structuredClone(projects.find(p=>p.id===draft?.id)||projects[0]||fresh());renderList();render();message(projects.length?'保存した歩みを読み込みました。':'最初の目標を作ってみましょう。');
      }catch(error){if(g===generation)message(error.message);}
      finally{if(g===generation){loading=false;el('ayumiFields').disabled=false;saveState();}}
    }
    el('openAyumi').onclick=()=>{
      if(!draft){draft=fresh();render();}
      dialog.showModal();
      if(!dirty && canSave())void load();
    };
    el('closeAyumi').onclick=()=>dialog.close();
    el('ayumiNew').onclick=()=>{if(loading||!discard())return;draft=fresh();dirty=false;render();message('目標と、できそうな一歩を書いてみましょう。');el('ayumiName').focus();};
    el('ayumiReload').onclick=load;
    ['ayumiName','ayumiDue','ayumiInsight'].forEach(id=>{el(id).oninput=changed;});
    el('ayumiAdd').onclick=()=>{
      if(draft.items.length>=100){message('項目は100件までです。');return;}
      const item={id:crypto.randomUUID(),text:'',done:false};expanded.add(item.id);draft.items.push(item);changed();renderItems();el('ayumiItems').lastElementChild.querySelector('input[type=text]').focus();
    };
    el('ayumiUndo').onclick=()=>{
      if(draft.deleted_items.length)restore(draft.deleted_items.length-1);
    };
    el('ayumiSave').onclick=async()=>{
      if(loading||!canSave())return;
      const g=++generation,c=context();
      const next=DragonAyumi.withInsight(read(),draft);
      try{DragonAyumi.normalize(next);}catch(error){message(error.message);return;}
      draft=next;loading=true;saveState();el('ayumiFields').disabled=true;message('保存しています…');
      try{
        const saved=await DragonAyumi.save(c.db,c.session.user.id,draft);
        if(g!==generation)return;
        draft=saved;dirty=false;projects=[saved,...projects.filter(p=>p.id!==saved.id)];renderList();render();message('歩みを保存しました。あなたのペースで大丈夫です。');
      }catch(error){if(g===generation)message(error.message);}
      finally{if(g===generation){loading=false;el('ayumiFields').disabled=false;saveState();}}
    };
    for(const [id,reflect] of [['ayumiSplit',false],['ayumiReflect',true]])el(id).onclick=()=>{
      try { if(prepareChat(DragonAyumi.prompt(read(),reflect)))dialog.close(); }
      catch(error){message(error.message);}
    };
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
    return {reset(){generation++;planner?.reset();projects=[];draft=null;dirty=false;loading=false;dialog.close();el('ayumiFields').disabled=false;el('ayumiList').replaceChildren();el('ayumiItems').replaceChildren();el('ayumiTrashList').replaceChildren();el('ayumiInsightList').replaceChildren();['ayumiName','ayumiDue','ayumiInsight'].forEach(id=>{el(id).value='';});saveState();message('');}};
  }
};
