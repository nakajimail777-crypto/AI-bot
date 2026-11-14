(() => {
  const names = {gemini:'Gemini',openai:'OpenAI'};
  const valid = id => Object.hasOwn(names,id);
  function mount({select,hint,userId=()=>null,onChange=()=>{},storage}) {
    if(storage===undefined){try{storage=globalThis.localStorage;}catch{storage=null;}}
    let providers=[],selected='gemini',configured=false,busy=false;
    const key=()=>`spirit-dragon.ai-provider.${userId()||'guest'}`;
    const available=()=>providers.some(p=>p.id===selected&&p.available);
    function render(){
      select.replaceChildren();
      for(const id of Object.keys(names)){
        const item=providers.find(p=>p.id===id),option=document.createElement('option');
        option.value=id;option.textContent=names[id]+(configured&&!item?.available?'（準備中）':'');
        option.disabled=!item?.available;select.append(option);
      }
      select.value=selected;select.disabled=!configured||busy||!providers.some(p=>p.available);
      hint.textContent=!configured?'AIの接続を確認しています…':!available()?`${names[selected]}は準備中です。利用できるAIを選んでください。`:'次の返答から切り替わります。会話の続きは引き継がれます。';
    }
    function restore(){
      let saved;try{saved=storage?.getItem(key());}catch{}
      selected=valid(saved)?saved:'gemini';render();
    }
    select.addEventListener('change',()=>{
      const next=select.value;
      if(busy||!valid(next)||!providers.some(p=>p.id===next&&p.available)){render();return;}
      if(next===selected)return;
      selected=next;try{storage?.setItem(key(),selected);}catch{}
      render();onChange(selected);
    });
    render();
    return {
      configure(config){
        // A missing list supports an older server during a rolling deployment.
        providers=Array.isArray(config.providers)?config.providers.filter(p=>valid(p?.id)).map(p=>({id:p.id,available:p.available===true})):[{id:'gemini',available:true}];
        configured=true;restore();
      },
      restore,
      setBusy(value){if(busy!==!!value){busy=!!value;render();}},
      get:()=>selected,
      available,
      label:()=>names[selected],
    };
  }
  globalThis.DragonAIProvider={mount};
})();
