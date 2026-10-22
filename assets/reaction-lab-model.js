export const steps=['観察','発見','選択','実験','振り返り'];
export const groups=[
 [['event','どんな出来事がありましたか？'],['feelings','どんな感情や身体感覚がありましたか？'],['usualReaction','どんな反応をしましたか？']],
 [['discovery','振り返って気づいたことはありますか？'],['pattern','いつも似た反応をしていますか？（まだわからなくても大丈夫です）']],
 [['chosenReaction','次はどんな反応を試してみたいですか？']],
 [['situation','どんな場面で試しますか？'],['plan','何を一つ試しますか？'],['expectation','どうなりそうですか？（予想がなくても大丈夫です）']],
 [['actualReaction','実際に何が起き、どんな反応をしましたか？'],['afterFeelings','何を感じましたか？'],['insight','新しく気づいたことはありますか？'],['difference','最初の予想と何が違いましたか？']]
];
export const labels=Object.fromEntries(groups.flat());
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createExperiment(){return {id:crypto.randomUUID(),version:1,step:0,status:'draft',choice:'undecided',attempt:'not_yet',fields:Object.fromEntries(Object.keys(labels).map(k=>[k,'']))};}
export function validateExperiment(data){
 if(!data||!uuid.test(data.id)||data.version!==1||!Number.isInteger(data.step)||data.step<0||data.step>4||!['draft','planned','finished','skipped'].includes(data.status)||!['undecided','try','keep'].includes(data.choice)||!['not_yet','tried','skipped'].includes(data.attempt)||!data.fields)throw new Error('INVALID_RECORD');
 for(const key of Object.keys(labels))if(typeof data.fields[key]!=='string'||Array.from(data.fields[key]).length>2000)throw new Error('INVALID_RECORD');
 return {id:data.id,version:1,step:data.step,status:data.status,choice:data.choice,attempt:data.attempt,fields:Object.fromEntries(Object.keys(labels).map(k=>[k,data.fields[k]]))};
}
export function repeatExperiment(source,edit=false){
 const next=createExperiment();
 for(const key of ['event','feelings','usualReaction','discovery','pattern','chosenReaction','situation','plan','expectation'])next.fields[key]=source.fields[key];
 next.choice=source.choice;next.step=edit?2:3;return next;
}
export function importReflection(source){
 const next=createExperiment();
 for(const [from,to] of [['event','event'],['feeling','feelings'],['reaction','usualReaction']]){
  const item=source?.fields?.[from];if(!item||item.skipped)continue;
  const value=Array.isArray(item.value)?[item.value.join('、'),item.note||''].filter(Boolean).join('\n'):item.value;
  if(typeof value==='string')next.fields[to]=value;
 }
 return next;
}
export function consultationText(data){
 return `反応の実験室：${steps[data.step]}\n今回の選択：${{undecided:'まだ決めない',try:'別の反応を試したい',keep:'今の反応を変えずに観察する'}[data.choice]}\n実験の状態：${{not_yet:'まだ試していない',tried:'試してみた',skipped:'今回は見送った'}[data.attempt]}\n\n`+groups.slice(0,data.step+1).flat().map(([key,title])=>`${title}\n${data.fields[key]||'未入力'}`).join('\n\n');
}
