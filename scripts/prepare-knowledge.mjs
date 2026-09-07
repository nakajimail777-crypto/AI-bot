import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareNote(source) {
  const text=source.replace(/\r\n/g,'\n').trim();
  if(!text || text.length>60000)throw new Error('ノートは1〜60,000文字で指定してください。');
  const title=text.match(/^# (.+)$/m)?.[1] || '龍秘術・組み合わせ解釈ノート';
  const sections=text.split(/(?=^## )/m);
  const general=sections.filter(s=>!/^## 例：/m.test(s)).join('\n\n');
  const examples=sections.filter(s=>/^## 例：/m.test(s));
  const chunks=[general,...examples].filter(s=>s.trim()).map((content,index)=>{
    const heading=content.match(/^## 例：(.+)$/m)?.[1];
    const label=heading?`${title}：${heading}`:`${title}：読み方の基本`;
    const prefix=heading?'この項目は見出しに記載された龍性・龍導の順序の組み合わせに限る解釈例です。逆順や龍望への置き換えはしません。\n':'';
    const body=`# ${label}\n\n${prefix}${content.trim()}`;
    if(body.length>12000)throw new Error('項目が長すぎます。見出しを増やして分割してください。');
    return {index,title:label,content:body};
  });
  if(chunks.length>20)throw new Error('一度に登録できる項目は20件までです。');
  return {title,source_name:'ryuhijutsu-combination-interpretation-notes.md',sha256:createHash('sha256').update(text).digest('hex'),chunks};
}

export async function embed(text,{fetcher=fetch,key}={}) {
  if(!key)throw new Error('GEMINI_API_KEYが設定されていません。キーをチャットに貼らず、実行環境で設定してください。');
  const res=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',{
    method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({content:{parts:[{text}]},output_dimensionality:768}),signal:AbortSignal.timeout(30000)
  });
  if(!res.ok)throw new Error(`検索データの作成に失敗しました（HTTP ${res.status}）。登録用SQLは作成していません。`);
  const data=await res.json();const values=data?.embedding?.values || data?.embeddings?.[0]?.values;
  if(!Array.isArray(values)||values.length!==768||values.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new Error('検索データの形式が不正です。');
  const length=Math.hypot(...values);
  if(!Number.isFinite(length)||length===0)throw new Error('検索データが空です。');
  return values.map(v=>v/length);
}

const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function registrationSql(note,vectors,queryVectors) {
  if(vectors.length!==note.chunks.length)throw new Error('項目数と検索データ数が一致しません。');
  for(const vector of [...vectors,...queryVectors])if(vector.length!==768||vector.some(v=>!Number.isFinite(v)))throw new Error('検索データの形式が不正です。');
  const id='6c0b9c29-2236-5cef-9ce3-173f38d72ba2';
  const metadata=JSON.stringify({source_sha256:note.sha256,embedding_model:'gemini-embedding-2',dimensions:768,origin:'user-edited interpretation note'});
  const rows=note.chunks.map((chunk,i)=>`(${quote(id)}, ${i}, ${quote(chunk.content)}, ${quote(JSON.stringify(vectors[i]))}, ${quote(JSON.stringify({source_sha256:note.sha256,title:chunk.title}))}::jsonb)`).join(',\n');
  return `-- Generated from the user-edited note. No API keys included.\n-- Run in Supabase SQL Editor. Only this note is updated.\nbegin;\nset local lock_timeout='3s';\nselect pg_advisory_xact_lock(17383281);\ninsert into public.knowledge_documents(id,title,source_name,status,metadata)\nvalues (${quote(id)},${quote(note.title)},${quote(note.source_name)},'active',${quote(metadata)}::jsonb)\non conflict(id) do update set title=excluded.title, source_name=excluded.source_name, status='active', metadata=excluded.metadata, updated_at=now();\ndelete from public.knowledge_chunks where document_id=${quote(id)};\ninsert into public.knowledge_chunks(document_id,chunk_index,content,embedding,metadata) values\n${rows};\ncommit;\n\n-- Stored chunk count must be ${note.chunks.length}.\nselect count(*) as stored_chunks from public.knowledge_chunks where document_id=${quote(id)};\n\n-- Retrieval checks: existing production query format and threshold.\n${queryVectors.map((v,i)=>`-- ${i===0?'龍性5・龍導3':'龍性2・龍導4'}\nselect * from public.match_knowledge(query_embedding := ${quote(JSON.stringify(v))}, match_threshold := 0.58, match_count := 4);`).join('\n')}\n`;
}

async function main(){
  const args=process.argv.slice(2),dry=args.includes('--dry-run');
  const file=args.find(a=>!a.startsWith('--')) || 'knowledge/ryuhijutsu-combination-interpretation-notes.md';
  const note=prepareNote(await readFile(resolve(file),'utf8'));
  console.log(JSON.stringify({title:note.title,sha256:note.sha256,chunks:note.chunks.map(c=>({title:c.title,characters:c.content.length}))},null,2));
  if(dry){console.log('事前確認完了。外部送信・データベース変更はありません。');return;}
  const key=process.env.GEMINI_API_KEY;
  if(!key)throw new Error('GEMINI_API_KEYが未設定のため、ここで停止しました。キーをチャットに貼らず、設定済みの環境で実行してください。');
  const vectors=[];
  for(const chunk of note.chunks)vectors.push(await embed(`title: ${chunk.title} | text: ${chunk.content}`,{key}));
  const queries=[];
  for(const query of ['龍性5・龍導3の組み合わせを教えてください','龍性2・龍導4の組み合わせを教えてください'])queries.push(await embed(`task: retrieval | query: ${query}`,{key}));
  const output=resolve('output/knowledge/combination-note-registration.sql');await mkdir(dirname(output),{recursive:true});
  await writeFile(output,registrationSql(note,vectors,queries),'utf8');
  console.log(`登録用SQLを作成しました: ${output}\nまだデータベースには登録していません。`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('登録準備を完了できませんでした。接続設定・入力ファイル・通信状態を確認してください。データベースは変更していません。');process.exitCode=1;});
