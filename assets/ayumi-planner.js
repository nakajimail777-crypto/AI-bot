// AI proposes only. Saving a new project requires the user's explicit action.
globalThis.DragonAyumiPlanner={
  plan(value){
    if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>120||!Array.isArray(value.items)||!value.items.length||value.items.length>20||value.items.some(s=>typeof s!=='string'||!s.trim()||s.length>300))throw new Error('目標名と各項目を確認してください（1〜20項目）。');
    return {title:value.title.trim(),items:value.items.map(text=>({id:crypto.randomUUID(),text:text.trim(),done:false}))};
  },
  mount({context,apply}){
    const el=id=>document.getElementById(id);let version=0,plan=null,controller=null,applying=false;
    const status=text=>{el('ayumiPlanStatus').textContent=text;};
    function clear(){plan=null;el('ayumiPlanReview').hidden=true;el('ayumiPlanItems').replaceChildren();el('ayumiPlanTitle').value='';}
    function render(){
      el('ayumiPlanTitle').value=plan.title;el('ayumiPlanItems').replaceChildren();el('ayumiPlanReview').hidden=false;
      plan.items.forEach((text,index)=>{
        const row=document.createElement('div');row.className='ayumi-plan-row';
        const input=document.createElement('textarea');input.maxLength=300;input.value=text;input.rows=2;input.setAttribute('aria-label',`提案項目${index+1}`);input.oninput=()=>{plan.items[index]=input.value;};
        const remove=document.createElement('button');remove.type='button';remove.className='plain-button';remove.textContent='外す';remove.setAttribute('aria-label',`提案項目${index+1}を外す`);remove.onclick=()=>{plan.items.splice(index,1);render();};
        row.append(input,remove);el('ayumiPlanItems').append(row);
      });
    }
    el('ayumiPlanTitle').oninput=()=>{if(plan)plan.title=el('ayumiPlanTitle').value;};
    el('ayumiPlanGenerate').onclick=async()=>{
      const goal=el('ayumiPlanGoal').value.trim();
      if(!goal||goal.length>2000){status('目標を1〜2,000文字で入力してください。');return;}
      if(controller)return;
      const c=context();
      if(!c.db||!c.session||c.session.user.is_anonymous){status('AIで案を作るにはログインしてください。');return;}
      const v=++version,requestController=new AbortController();controller=requestController;
      const timeout=setTimeout(()=>requestController.abort(),80000);
      clear();el('ayumiPlanGenerate').disabled=true;el('ayumiPlanGoal').disabled=true;status('小さな一歩の案を考えています…');
      try{
        const {data,error}=await c.db.auth.getSession();
        if(v!==version)return;
        if(error||!data?.session?.access_token||data.session.user.id!==c.session.user.id)throw new Error('ログインし直してください。');
        const response=await fetch('/api/ayumi-plan',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${data.session.access_token}`},body:JSON.stringify({goal}),signal:requestController.signal});
        const result=await response.json();if(v!==version)return;
        if(!response.ok)throw new Error(result.error||'案を作れませんでした。');
        DragonAyumiPlanner.plan(result.plan);plan={title:result.plan.title,items:[...result.plan.items]};render();
        status(result.preview===true?'操作確認用の模擬応答です。実際のAIには接続していません。':'案ができました。内容を確認し「新しい目標として保存」を押すと一覧に追加されます。今の目標に項目を足すこともできます。まだ保存していません。');
      }catch(error){if(v===version)status(error.name==='AbortError'?'作成を中止しました。入力は残っています。':error.message||'案を作れませんでした。');}
      finally{clearTimeout(timeout);if(v===version){controller=null;el('ayumiPlanGenerate').disabled=false;el('ayumiPlanGoal').disabled=false;}}
    };
    el('ayumiPlanGoal').oninput=()=>{clear();status('');};
    async function adopt(append){
      if(!plan||applying)return;
      const v=version;applying=true;
      el('ayumiPlanApply').disabled=true;el('ayumiPlanAppend').disabled=true;
      try{
        const clean=DragonAyumiPlanner.plan(plan);
        status(append?'目標に追加しています…':'新しい目標を保存しています…');
        const accepted=await apply(clean,append);
        if(v!==version)return;
        if(!accepted){status('案は残っています。目標の変更を確認してから、もう一度お試しください。');return;}
        clear();status(append?'現在の目標に追加しました。「変更を保存」で記録できます。':'新しい目標を保存し、取り組み中の目標に追加しました。');
      }catch(error){if(v===version)status(error.message);}
      finally{applying=false;el('ayumiPlanApply').disabled=false;el('ayumiPlanAppend').disabled=false;}
    }
    el('ayumiPlanApply').onclick=()=>adopt(false);
    el('ayumiPlanAppend').onclick=()=>adopt(true);
    el('ayumiPlanCancel').onclick=()=>{version++;controller?.abort();controller=null;clear();el('ayumiPlanGenerate').disabled=false;el('ayumiPlanGoal').disabled=false;status('案を取り消しました。今の目標は変更していません。');};
    return {reset(){version++;controller?.abort();controller=null;clear();el('ayumiPlanGenerate').disabled=false;el('ayumiPlanGoal').disabled=false;el('ayumiPlanGoal').value='';status('');}};
  }
};
