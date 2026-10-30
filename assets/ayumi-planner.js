// AI proposes only. The user explicitly applies and then saves a new project.
globalThis.DragonAyumiPlanner={
  plan(value){
    if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>120||!Array.isArray(value.items)||!value.items.length||value.items.length>20||value.items.some(s=>typeof s!=='string'||!s.trim()||s.length>300))throw new Error('目標名と各項目を確認してください（1〜20項目）。');
    return {title:value.title.trim(),items:value.items.map(text=>({id:crypto.randomUUID(),text:text.trim(),done:false}))};
  },
  mount({context,apply}){
    const el=id=>document.getElementById(id);let version=0,plan=null,controller=null;
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
        status(result.preview===true?'操作確認用の模擬応答です。実際のAIには接続していません。':'案ができました。編集して「この内容で作成」を押してください。まだ保存していません。');
      }catch(error){if(v===version)status(error.name==='AbortError'?'作成を中止しました。入力は残っています。':error.message||'案を作れませんでした。');}
      finally{clearTimeout(timeout);if(v===version){controller=null;el('ayumiPlanGenerate').disabled=false;el('ayumiPlanGoal').disabled=false;}}
    };
    el('ayumiPlanGoal').oninput=()=>{clear();status('');};
    el('ayumiPlanApply').onclick=()=>{
      try{if(!plan)return;const clean=this.plan(plan);if(!apply(clean))return;clear();status('新しい目標を作成しました。画面下の「保存」で記録できます。');}
      catch(error){status(error.message);}
    };
    el('ayumiPlanCancel').onclick=()=>{version++;controller?.abort();controller=null;clear();el('ayumiPlanGenerate').disabled=false;el('ayumiPlanGoal').disabled=false;status('案を取り消しました。今の目標は変更していません。');};
    return {reset(){version++;controller?.abort();controller=null;clear();el('ayumiPlanGenerate').disabled=false;el('ayumiPlanGoal').disabled=false;el('ayumiPlanGoal').value='';status('');}};
  }
};
