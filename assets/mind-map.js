// A view of explicit reflection input only. No inference, persistence or network calls.
const steps = [
  ['event','出来事','◇'], ['feeling','感じたこと','♡'],
  ['interpretation','受け取り方','◉'], ['reaction','反応','↗'],
  ['afterglow','振り返り','↺']
];
export function mapCards(reflection) {
  return steps.map(([id,title,icon])=>{
    const item=reflection.fields[id];
    const value=Array.isArray(item.value)
      ? [item.value.join('、'),item.note||''].filter(text=>text.trim()).join('\n') : item.value;
    return {id,title,icon,text:item.skipped?'スキップした項目':value.trim()?value:'まだ言葉になっていない'};
  });
}

export function createMindMap(host, onReturn) {
  let snapshot=null;
  const doc=host.ownerDocument;
  function node(tag,attrs={},text){
    const n=doc.createElement(tag);
    for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);
    if(text!==undefined)n.textContent=text;
    return n;
  }
  const panel=node('section',{class:'mr-map','aria-labelledby':'mr-map-title','aria-live':'off'});
  panel.hidden=true;
  const heading=node('h2',{id:'mr-map-title'},'心の動き');
  const toggle=node('button',{type:'button','aria-controls':'mr-map-cards','aria-expanded':'false'},'図で見る');
  const back=node('button',{type:'button'},'振り返りの文章・保存へ戻る');
  const cards=node('ol',{id:'mr-map-cards',class:'mr-map-cards'});
  const note=node('p',{class:'mr-map-note'},'振り返りに入力した内容です。矢印は項目の並びを示し、原因や順序を断定するものではありません。「この図」「これ」などに言及して送信すると、開いている図の5項目をAIが参照します。');
  const saveNote=node('p',{class:'mr-map-note'},'図の開閉では保存されません。再読み込み後は、保存した振り返りから開き直せます。未保存の入力はページを閉じると消えます。');
  const controls=node('div',{class:'mr-map-controls'});controls.append(toggle,back);
  panel.append(heading,note,controls,cards,saveNote);host.prepend(panel);
  function expand(open){cards.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'図を閉じる':'図で見る';}
  toggle.addEventListener('click',()=>expand(cards.hidden));
  back.addEventListener('click',()=>onReturn(back));
  expand(false);
  return {
    context(message){
      if(panel.hidden||cards.hidden||!/(?:この図|図解|心の動き|マップ|このカード|この内容|こちら|これ(?!から)|それ)/.test(message))return null;
      return structuredClone(snapshot);
    },
    show(reflection){
      snapshot={version:1,id:reflection.id,fields:Object.fromEntries(mapCards(reflection).map(c=>[c.id,c.text]))};
      cards.replaceChildren();
      for(const [i,card] of mapCards(reflection).entries()){
        const row=node('li',{class:'mr-map-step'});
        const box=node('div',{class:'mr-map-card mr-map-'+card.id});
        const title=node('h3');
        title.append(node('span',{'aria-hidden':'true',class:'mr-map-icon'},card.icon),doc.createTextNode(`${i+1}. ${card.title}`));
        box.append(title,node('p',{},card.text));row.append(box);
        if(i<4)row.append(node('div',{class:'mr-map-arrow','aria-hidden':'true'},'↓'));
        cards.append(row);
      }
      panel.hidden=false;expand(true);return toggle;
    },
    clear(){snapshot=null;panel.hidden=true;cards.replaceChildren();expand(false);}
  };
}
