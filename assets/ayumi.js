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
      return {id:item.id, text, done:item.done, ...this.weekFields(item),...this.dailyFields(item)};
    });
    const insight = String(value.insight || '').trim();
    if (insight.length > 500) throw new Error('今日の気づきは500文字までです。');
    const deleted_items = value.deleted_items || [];
    if (!Array.isArray(deleted_items) || deleted_items.length>100) throw new Error('保管できる削除項目は100件までです。不要な項目を完全に削除してください。');
    const trash = deleted_items.map(entry=>{
      const item=entry.item;
      if(!item || typeof item.id!=='string' || !item.id || item.id.length>80 || ids.has(item.id) || typeof item.text!=='string' || item.text.length>300 || typeof item.done!=='boolean' || !Number.isInteger(entry.index) || entry.index<0 || entry.index>99 || !this.validDate(entry.deleted_on))throw new Error('削除した項目の形式を確認してください。');
      ids.add(item.id);
      return {item:{id:item.id,text:item.text,done:item.done,...this.weekFields(item),...this.dailyFields(item)},index:entry.index,deleted_on:entry.deleted_on};
    });
    if([...items,...trash.map(e=>e.item)].reduce((n,i)=>n+(i.daily?.checks.length||0),0)>5000)throw new Error('日別の記録は削除した項目を含め5,000件までです。');
    const insight_history=value.insight_history||[];
    if(!Array.isArray(insight_history)||insight_history.length>500)throw new Error('気づきの履歴は500件までです。');
    const noteIds=new Set();
    const history=insight_history.map(entry=>{
      if(typeof entry.id!=='string'||!entry.id||entry.id.length>80||noteIds.has(entry.id)||typeof entry.text!=='string'||!entry.text.trim()||entry.text.length>500||(entry.date!==null&&!this.validDate(entry.date)))throw new Error('気づきの履歴の形式を確認してください。');
      noteIds.add(entry.id);return {id:entry.id,date:entry.date,text:entry.text};
    });
    if(value.archived!==undefined&&typeof value.archived!=='boolean')throw new Error('保管状態を確認してください。');
    return {title, due_date, items, insight, deleted_items:trash, insight_history:history, archived:value.archived??false};
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
  dailyFields(item){
    if(item.daily===undefined)return {};
    if(item.weeks?.length)throw new Error('日別と週別は別の項目で記録してください。');
    const d=item.daily;
    if(!d||d.timezone!=='Asia/Tokyo'||!this.validDate(d.start)||!this.validDate(d.end)||d.start>d.end||!Array.isArray(d.checks)||d.checks.length>366||this.addDays(d.start,365)<d.end)throw new Error('日別の期間と保管する日付は各項目366日までです。');
    let previous='';const dates=new Set();
    const checks=d.checks.map(c=>{if(!this.validDate(c.date)||typeof c.done!=='boolean'||c.date<=previous)throw new Error('日別の記録を確認してください。');previous=c.date;dates.add(c.date);if(c.missed!==undefined&&(typeof c.missed!=='boolean'||(c.missed&&c.done)))throw new Error('日別の記録状態を確認してください。');return {date:c.date,done:c.done,...(c.missed!==undefined?{missed:c.missed}:{})};});
    for(let date=d.start;date<=d.end;date=this.addDays(date,1))if(!dates.has(date))throw new Error('日別の記録が不足しています。');
    return {daily:{start:d.start,end:d.end,timezone:d.timezone,checks}};
  },
  dailyRange(start,end,existing){
    if(!this.validDate(start)||!this.validDate(end)||start>end||this.addDays(start,365)<end)throw new Error('開始日から終了日まで366日以内で指定してください。');
    const records=new Map((existing?.checks||[]).map(c=>[c.date,{...c}]));
    for(let date=start;date<=end;date=this.addDays(date,1))if(!records.has(date))records.set(date,{date,done:false});
    return this.dailyFields({daily:{start,end,timezone:'Asia/Tokyo',checks:[...records.values()].sort((a,b)=>a.date.localeCompare(b.date))}}).daily;
  },
  dailyToday(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());},
  appendPlan(project,plan){
    if(project.items.length+plan.items.length>100)throw new Error('項目は100件までです。');
    return {...project,items:[...project.items,...structuredClone(plan.items)]};
  },
  addDays(date,days){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);},
  units(items){return items.flatMap(i=>i.daily?i.daily.checks.filter(c=>c.date>=i.daily.start&&c.date<=i.daily.end):i.weeks?.length?i.weeks:[i]);},
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
    const units=this.units(items), total = units.length, done = units.filter(item => item.done === true || item.missed === true).length;
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
    if(project.daily_revision||[...payload.items,...payload.deleted_items.map(e=>e.item)].some(i=>i.daily))payload.daily_revision=(project.daily_revision||0)+1;
    await this.user(db, owner);
    let query = db.from('ayumi_projects');
    query = project.version == null
      ? query.insert({id:project.id, ...payload})
      : query.update({...payload, version:project.version+1}).eq('id',project.id).eq('user_id',owner).eq('version',project.version);
    const {data,error} = await query.select('*').maybeSingle();
    if (!error && data) return data;
    // If a response was lost, a repeated Save is successful only for identical data.
    const current = await db.from('ayumi_projects').select('*').eq('id',project.id).eq('user_id',owner).maybeSingle();
    if (!current.error && current.data && JSON.stringify(this.normalize(current.data)) === JSON.stringify(this.normalize(project))) return current.data;
    if(error?.message?.includes('Reload required'))throw new Error('日別記録を守るため保存を止めました。入力を控えて画面を再読み込みしてください。');
    if ((!error && !data) || error?.code === '23505') throw new Error('別の画面で更新されています。入力を控えてから一覧を再読み込みしてください。');
    throw new Error('保存できませんでした。入力は残っています。接続を確認して再度保存してください。');
  },
  prompt(project, reflect) {
    const p = this.normalize(project), count = this.progress(p.items);
    return `${reflect ? 'この歩みを一緒に振り返ってください。成果だけでなく気づきも大切にしてください。' : 'この目標を無理のない小さな行動に分ける案をください。'}\n進捗の遅れを責めず、完璧な達成を求めないでください。チェックを完了したと判断したり、保存したと伝えたりしないでください。提案の採用と完了チェックは私が決めます。\n目標：${p.title}\n期限：${p.due_date || '設定なし'}\n歩み：${count.done}/${count.total}\n${p.items.map(i=>`${i.daily||i.weeks?.length?'':i.done?'☑':'☐'} ${i.text}${i.daily?'\n日別：'+i.daily.start+'〜'+i.daily.end+'（日本時間）\n'+this.units([i]).map(c=>(c.done?'できた':c.missed?'できなかった・記録済み':'未記録')+' '+c.date).join('\n'):''}${(i.weeks||[]).map(w=>`\n  ${w.done?'☑':'☐'} ${w.start}〜${this.addDays(w.start,6)}`).join('')}`).join('\n')}\n今日の気づき：${p.insight || 'まだ記入していません'}${reflect?'\n最近の気づき（最大5件）：\n'+p.insight_history.slice(-5).map(n=>`${n.date||'日付未記録'}：${n.text}`).join('\n'):''}`;
  },
  mount({context, prepareChat}) {
    const el = id => document.getElementById(id), dialog = el('ayumiDialog');
    const dailyPages=new Map();let selectedDay=DragonAyumi.dailyToday();
    const fields=el('ayumiFields');
    const todaySection=document.createElement('section');todaySection.className='ayumi-today-panel';
    todaySection.innerHTML='<h3 id="ayumiDayHeading">1日の記録</h3><div class="compact-date-nav"><button type="button" id="compactPrev" class="plain-button">〈 前の日</button><input type="date" id="compactDate" aria-label="記録する日"><button type="button" id="compactNext" class="plain-button">次の日 〉</button></div><button type="button" id="compactToday" class="plain-button">今日に戻る</button><div id="ayumiDayActions"></div><p id="ayumiDayCount" aria-live="polite"></p>';
    const past=document.createElement('details');past.className='ayumi-simple-fold';
    past.innerHTML='<summary>これまでの記録</summary><label for="ayumiPastDate">振り返る日</label><input id="ayumiPastDate" type="date"><div id="ayumiPastActions"></div><p id="ayumiPastCount" aria-live="polite"></p>';
    const edit=document.createElement('details');edit.className='ayumi-simple-fold';edit.id='ayumiEdit';
    const editTitle=document.createElement('summary');editTitle.textContent='目標・行動を編集';edit.append(editTitle);
    const insightLabel=fields.querySelector('label[for=ayumiInsight]');
    for(const child of [...fields.children]){if(child===insightLabel)break;if(child.tagName!=='LEGEND')edit.append(child);}
    const archive=el('ayumiArchive').parentElement;edit.append(el('ayumiPlanner'));
    const aiActions=el('ayumiSplit').parentElement,aiHint=aiActions.nextElementSibling;edit.append(aiActions,aiHint);
    const overview=document.createElement('section');overview.className='ayumi-overview';
    const overviewTitle=document.createElement('h3');overviewTitle.textContent='記録の進み具合';
    const overviewHint=document.createElement('p');overviewHint.className='ayumi-overview-hint';overviewHint.textContent='できた日も、できなかったと記録した日も、歩みに含めます。';
    overview.append(overviewTitle,edit.querySelector('#ayumiCount'),edit.querySelector('#ayumiProgress'),overviewHint);
    const timeline=document.createElement('div');timeline.id='ayumiRecordBreakdown';overview.append(timeline,archive);
    const vaultLink=document.createElement('button');vaultLink.type='button';vaultLink.className='plain-button';vaultLink.textContent='保管庫を見る';
    vaultLink.onclick=()=>{el('ayumiPicker').open=true;el('ayumiArchived').open=true;el('ayumiArchivedCount').focus();};archive.append(vaultLink);
    fields.insertBefore(overview,fields.querySelector('legend').nextSibling);overview.after(todaySection);
    fields.append(past,edit);
    past.hidden=true;fields.insertBefore(el('ayumiInsights'),edit);
    el('compactDate').onchange=()=>{if(DragonAyumi.validDate(el('compactDate').value)){selectedDay=el('compactDate').value;renderDay();}};
    el('compactPrev').onclick=()=>{selectedDay=DragonAyumi.addDays(selectedDay,-1);renderDay();};
    el('compactNext').onclick=()=>{selectedDay=DragonAyumi.addDays(selectedDay,1);renderDay();};
    el('compactToday').onclick=()=>{selectedDay=DragonAyumi.dailyToday();renderDay();};
    el('ayumiHint').textContent='チェックと気づきは、下の「保存」で記録します。';
    el('ayumiInsight').rows=2;
    el('ayumiPastDate').max=DragonAyumi.dailyToday();el('ayumiPastDate').value=DragonAyumi.dailyToday();
    el('ayumiPastDate').onchange=()=>renderDay();

    let projects = [], draft = null, dirty = false, generation = 0, loading = false;
    const message = text => { el('ayumiStatus').textContent = text; };
    const canSave = () => { const c=context(); return c.db && c.session && !c.session.user.is_anonymous; };
    const fresh = () => ({id:crypto.randomUUID(),title:'',due_date:null,items:[],insight:'',deleted_items:[],insight_history:[]});
    function saveState(){
      el('ayumiDirty').textContent=loading?'処理中…':dirty?'未保存':draft?.version?'保存済み':'まだ保存していません';
      el('ayumiDirty').dataset.dirty=String(dirty);
      el('ayumiSave').disabled=loading||!canSave();
      el('ayumiSave').textContent=loading?'処理中…':'保存';
      el('ayumiArchive').disabled=loading||!draft?.version;
    }
    const changed = () => { dirty=true;saveState();updateCurrent(); message('未保存の変更があります。「保存」で記録できます。'); };
    const read = () => ({...draft,title:el('ayumiName').value,due_date:el('ayumiDue').value||null,insight:el('ayumiInsight').value});
    const planner=globalThis.DragonAyumiPlanner?.mount({context,apply(plan,append){
      if(loading)return false;
      if(append){draft=DragonAyumi.appendPlan(read(),plan);dirty=true;render();message('現在の目標に案を追加しました。「保存」で記録できます。');return true;}
      if(loading||!discard())return false;
      draft={...fresh(),title:plan.title,items:plan.items};dirty=true;render();
      message('案から新しい目標を作成しました。まだ保存していません。');
      edit.open=true;el('ayumiName').focus();return true;
    }});
    function renderDay(){
      const today=DragonAyumi.dailyToday();
      const dates=[...new Set(draft.items.flatMap(i=>i.daily?DragonAyumi.units([i]).map(c=>c.date):[]))].sort();
      const earliest=dates[0]&&dates[0]<today?dates[0]:today,latest=dates.at(-1)&&dates.at(-1)>today?dates.at(-1):today;
      if(selectedDay<earliest||selectedDay>latest)selectedDay=today;
      el('compactDate').value=selectedDay;el('compactDate').min=earliest;el('compactDate').max=latest;
      el('compactPrev').disabled=selectedDay<=earliest;el('compactNext').disabled=selectedDay>=latest;
      el('compactToday').disabled=selectedDay===today;
      el('ayumiDayHeading').textContent=selectedDay.slice(5).replace('-','/')+(selectedDay===today?' 今日の記録':selectedDay>today?' これからの予定':' の記録');
      const container=el('ayumiDayActions');container.replaceChildren();let total=0,done=0,missed=0;
      for(const item of draft.items){
        const unit=item.daily?DragonAyumi.units([item]).find(c=>c.date===selectedDay):null;if(!unit)continue;
        total++;if(unit.done)done++;if(unit.missed)missed++;
        const row=document.createElement('label');row.className='compact-action';
        const title=document.createElement('span');title.textContent=item.text||'新しい一歩';
        const select=document.createElement('select');select.setAttribute('aria-label',item.text+'の記録');
        for(const [value,text] of [['none','未記録'],['done','できた'],['missed','できなかった']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
        select.value=unit.done?'done':unit.missed?'missed':'none';select.dataset.state=select.value;select.disabled=selectedDay>today;
        select.onchange=()=>{unit.done=select.value==='done';unit.missed=select.value==='missed';changed();renderItems();};
        row.append(title,select);container.append(row);
      }
      el('ayumiDayCount').textContent=total?(selectedDay>today?'この日になったら記録できます。':`${total}件中${done+missed}件を記録 · できた ${done}・できなかった ${missed}`):'この日の行動はありません。「目標・行動を編集」で設定できます。';
    }
    function progress() {
      const p=DragonAyumi.progress(draft.items);
      el('ayumiCount').textContent=`${p.total}回分のうち ${p.done}回分を記録 · ${p.percent}%`;
      const units=DragonAyumi.units(draft.items);
      const timeline=el('ayumiRecordBreakdown');timeline.replaceChildren();
      const breakdown=document.createElement('p');breakdown.textContent=`できた ${units.filter(d=>d.done).length}回・できなかった ${units.filter(d=>d.missed).length}回`;timeline.append(breakdown);

      el('ayumiProgress').value=p.percent;updateCurrent();
    }
    function renderItems() {
      el('ayumiItems').replaceChildren();
      draft.items.forEach((item,index)=>{
        const card=document.createElement('section');card.className='ayumi-card';
        const summary=document.createElement('h4');summary.className='ayumi-item-heading';
        const updateSummary=()=>{const p=DragonAyumi.progress([item]);summary.textContent=(item.text||'新しい一歩')+' · '+p.done+'/'+p.total;card.classList.toggle('ayumi-complete',p.total>0&&p.done===p.total);};
        updateSummary();card.append(summary);
        const row=document.createElement('div'); row.className='ayumi-item';
        const check=document.createElement('input'); check.type='checkbox'; check.checked=item.done; check.setAttribute('aria-label',`項目${index+1}の完了`);
        check.hidden=!!item.weeks?.length||!!item.daily;
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
        renderDaily(card,item,index,updateSummary);
        const weekly=document.createElement('div');weekly.hidden=!!item.daily;weekly.className='ayumi-weekly';
        const hint=document.createElement('p');hint.textContent='週ごとに記録する場合は開始日を選んで追加します。チェックは自分で付け、保存してください。';weekly.append(hint);
        for(const week of item.weeks||[]){
          const label=document.createElement('label');label.className='ayumi-week';
          const box=document.createElement('input');box.type='checkbox';box.checked=week.done;
          const caption=document.createElement('span');caption.textContent=week.start+' 〜 '+DragonAyumi.addDays(week.start,6);
          // Native checked state also restores the visual completion mark after loading.
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
          item.weeks=weeks;changed();renderItems();
        };
        weekly.append(start,add);card.append(weekly);el('ayumiItems').append(card);
      });
      progress();renderDay();
      const history=draft.deleted_items;
      el('ayumiUndo').disabled=!history.length;
      el('ayumiUndo').textContent=history.length?`削除を元に戻す（${history.length}件）`:'削除を元に戻す';
      renderTrash();
    }
    function renderDaily(card,item,index,updateSummary){
      const section=document.createElement('div');section.className='ayumi-daily';card.append(section);
      if(item.weeks?.length){const note=document.createElement('p');note.textContent='日別の記録は「項目を追加」で別の項目を作ってください。';section.append(note);return;}
      const settings=document.createElement('details'),heading=document.createElement('summary');heading.textContent=item.daily?'毎日くり返す期間を変更':'この行動を毎日くり返す';settings.append(heading);section.append(settings);
      const explanation=document.createElement('p');explanation.textContent='選んだ期間は、その日の記録欄にこの行動が出てきます。その日に「できた／できなかった」を記録できます。';settings.append(explanation);
      const start=document.createElement('input'),end=document.createElement('input');start.type=end.type='date';start.value=item.daily?.start||DragonAyumi.dailyToday();end.value=item.daily?.end||el('ayumiDue').value||start.value;
      for(const [input,label] of [[start,'いつから'],[end,'いつまで']]){const wrapper=document.createElement('label');wrapper.textContent=label;input.setAttribute('aria-label',`項目${index+1}の日別${label}`);wrapper.append(input);settings.append(wrapper);}
      const button=document.createElement('button');button.type='button';button.className='plain-button';button.textContent=item.daily?'くり返す期間を変更する':'この期間で毎日の記録を作る';settings.append(button);
      const hint=document.createElement('p');hint.textContent='日本時間・最大366日。期間を短くしても過去の記録は残ります。変更後は「保存」してください。';settings.append(hint);
      button.onclick=()=>{try{
        if(!item.daily&&item.done){message('完了した項目は残して、新しい項目に日別の記録を作ってください。');return;}
        const daily=DragonAyumi.dailyRange(start.value,end.value,item.daily);
        const total=[...draft.items,...draft.deleted_items.map(e=>e.item)].reduce((n,i)=>n+(i.id===item.id?daily.checks.length:i.daily?.checks.length||0),0);
        if(total>5000)throw new Error('日別の記録は全体で5,000件までです。');
        item.daily=daily;dailyPages.delete(item.id);changed();renderItems();
      }catch(error){message(error.message);}};
      if(!item.daily)return;
      const days=DragonAyumi.units([item]),today=DragonAyumi.dailyToday();
      let page=dailyPages.get(item.id)??Math.floor((days.findIndex(d=>d.date>=today)<0?days.length-1:days.findIndex(d=>d.date>=today))/7);page=Math.min(page,Math.floor((days.length-1)/7));
      const count=document.createElement('p');count.textContent=`${days.length}日中${days.filter(d=>d.done).length}日できた · 日本時間`;section.append(count);
      const nav=document.createElement('div');nav.className='ayumi-actions';section.append(nav);
      for(const [label,target,disabled] of [['前の7日',page-1,page===0],['今日',Math.floor((days.findIndex(d=>d.date>=today)<0?days.length-1:days.findIndex(d=>d.date>=today))/7),false],['次の7日',page+1,(page+1)*7>=days.length]]){const b=document.createElement('button');b.type='button';b.className='plain-button';b.textContent=label;b.disabled=disabled;b.onclick=()=>{dailyPages.set(item.id,target);renderItems();};nav.append(b);}
      for(const day of days.slice(page*7,page*7+7)){
        const label=document.createElement('label');label.className='ayumi-week ayumi-day';if(day.date===today)label.classList.add('ayumi-today');
        const box=document.createElement('input');box.type='checkbox';box.checked=day.done;box.disabled=day.date>today;
        const caption=document.createElement('span');caption.textContent=day.date+(day.date===today?' 今日':day.date>today?' これから':'')+(day.missed?' · できなかった（記録済み）':'');
        box.onchange=()=>{day.done=box.checked;day.missed=false;changed();progress();renderDay();updateSummary();count.textContent=`${days.length}日中${days.filter(d=>d.done).length}日できた · 日本時間`;};label.append(box,caption);section.append(label);
      }
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
      renderInsights();saveState();updateCurrent();
    }
    const discard = () => !dirty || confirm('未保存の変更を破棄しますか？');
    function updateCurrent(){
      const title=el('ayumiName').value.trim()||'新しい目標';
      el('ayumiCurrent').textContent=(draft?.archived?'保管中：':'現在の目標：')+title;
      el('ayumiArchive').textContent=draft?.archived?'取り組み中に戻す':'保管庫に入れる';
      const p=DragonAyumi.progress(draft?.items||[]);
      el('ayumiArchiveHint').textContent=draft?.archived?'保管庫の目標です。戻す場合も「保存」を押してください。':(p.total>0&&p.done===p.total?'記録がそろいました。':'一区切りついた目標は保管できます。')+'「保管庫に入れる」→「保存」で一覧を整理します。';
    }
    function renderList() {
      el('ayumiList').replaceChildren();el('ayumiArchivedList').replaceChildren();
      el('ayumiArchivedCount').textContent='保管庫（'+projects.filter(p=>p.archived).length+'件）';
      for(const project of projects){
        const button=document.createElement('button');button.type='button';button.className='plain-button';
        const p=DragonAyumi.progress(project.items);button.textContent=project.title+'（'+p.done+'/'+p.total+'）';
        button.classList.toggle('ayumi-complete',p.total>0&&p.done===p.total);
        button.setAttribute('aria-current',String(project.id===draft?.id));
        button.onclick=()=>{if(loading||!discard())return;draft=structuredClone(project);dirty=false;render();renderList();el('ayumiPicker').open=false;message(project.archived?'保管庫の目標を開きました。「取り組み中に戻す」で戻せます。':'保存した歩みを開きました。');};
        el(project.archived?'ayumiArchivedList':'ayumiList').append(button);
      }
      if(!projects.some(p=>!p.archived)){const note=document.createElement('p');note.textContent='取り組み中の目標はありません。「＋ 新しい目標」から作れます。';el('ayumiList').append(note);}
    }
    async function load() {
      if(loading || !discard())return;
      if(!canSave()){message('ログインすると、保存した歩みを再表示できます。');return;}
      const g=++generation,c=context();loading=true;saveState();el('ayumiFields').disabled=true;message('読み込み中…');
      try{
        const result=await DragonAyumi.list(c.db,c.session.user.id);
        if(g!==generation)return;
        projects=result;dirty=false;draft=structuredClone(projects.find(p=>p.id===draft?.id)||projects.find(p=>!p.archived)||fresh());edit.open=!draft.items.some(i=>i.daily);renderList();render();message(projects.length?'保存した歩みを読み込みました。':'最初の目標を作ってみましょう。');
      }catch(error){if(g===generation)message(error.message);}
      finally{if(g===generation){loading=false;el('ayumiFields').disabled=false;saveState();}}
    }
    el('openAyumi').onclick=()=>{
      if(!draft){draft=fresh();render();}
      el('ayumiPastDate').max=DragonAyumi.dailyToday();renderDay();
      if(!draft.title)edit.open=true;
      dialog.showModal();
      if(!dirty && canSave())void load();
    };
    el('closeAyumi').onclick=()=>dialog.close();
    el('ayumiNew').onclick=()=>{if(loading||!discard())return;draft=fresh();dirty=false;render();edit.open=true;renderList();el('ayumiPicker').open=false;message('目標と、できそうな一歩を書いてみましょう。');el('ayumiName').focus();};
    el('ayumiReload').onclick=load;
    el('ayumiArchive').onclick=()=>{if(loading||!draft?.version)return;draft.archived=!draft.archived;changed();message(draft.archived?'保管庫への移動は未保存です。「保存」で一覧を整理できます。':'取り組み中への変更は未保存です。「保存」で記録できます。');};
    ['ayumiName','ayumiDue','ayumiInsight'].forEach(id=>{el(id).oninput=changed;});
    el('ayumiAdd').onclick=()=>{
      if(draft.items.length>=100){message('項目は100件までです。');return;}
      const item={id:crypto.randomUUID(),text:'',done:false};draft.items.push(item);changed();renderItems();el('ayumiItems').lastElementChild.querySelector('input[type=text]').focus();
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
      }catch(error){if(g===generation){render();message(error.message);}}
      finally{if(g===generation){loading=false;el('ayumiFields').disabled=false;saveState();}}
    };
    for(const [id,reflect] of [['ayumiSplit',false],['ayumiReflect',true]])el(id).onclick=()=>{
      try { if(prepareChat(DragonAyumi.prompt(read(),reflect)))dialog.close(); }
      catch(error){message(error.message);}
    };
    window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
    return {reset(){generation++;planner?.reset();projects=[];draft=null;dirty=false;loading=false;dialog.close();el('ayumiFields').disabled=false;el('ayumiList').replaceChildren();el('ayumiArchivedList').replaceChildren();el('ayumiPicker').open=false;el('ayumiCurrent').textContent='目標を選ぶ';el('ayumiArchivedCount').textContent='保管庫（0件）';el('ayumiArchiveHint').textContent='';el('ayumiDayActions').replaceChildren();el('ayumiPastActions').replaceChildren();el('ayumiRecordBreakdown').replaceChildren();el('ayumiDayCount').textContent='';el('ayumiPastCount').textContent='';el('ayumiCount').textContent='';el('ayumiProgress').value=0;edit.open=false;past.open=false;dailyPages.clear();selectedDay=DragonAyumi.dailyToday();el('ayumiPastDate').value=DragonAyumi.dailyToday();el('ayumiItems').replaceChildren();el('ayumiTrashList').replaceChildren();el('ayumiInsightList').replaceChildren();['ayumiName','ayumiDue','ayumiInsight'].forEach(id=>{el(id).value='';});saveState();message('');}};
  }
};
