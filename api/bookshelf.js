import { timingSafeEqual, randomUUID } from 'node:crypto';
import { embed } from '../scripts/prepare-knowledge.mjs';

const MAX_CHUNKS = 50;
const EMBEDDING_CONCURRENCY = 5;

export function prepareMarkdown(name, text) {
  if (typeof name !== 'string' || !/^[^/\\\x00-\x1f]{1,150}\.md$/i.test(name)) throw new Error('Markdown（.md）ファイルを選んでください。');
  if (typeof text !== 'string' || !text.trim() || text.length > 40000 || text.includes('\0')) throw new Error('本文は1〜40,000文字にしてください。');
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0,200) || name;
  const chunks = [];
  let current = '';
  for (const line of text.replace(/\r\n/g,'\n').split('\n')) {
    if ((/^#{1,3} /.test(line) && current.trim()) || current.length + line.length > 2600) {
      if(current.trim()) chunks.push(current.trim());
      current = '';
    }
    for(let pos=0;pos<line.length;pos+=2600) {
      const part=line.slice(pos,pos+2600);
      if(current.length+part.length>2600) { if(current.trim()) chunks.push(current.trim()); current=''; }
      current+=part+'\n';
    }
  }
  if(current.trim()) chunks.push(current.trim());
  if(chunks.length>MAX_CHUNKS) throw new Error(`項目が多いため、ファイルを分けてください（最大${MAX_CHUNKS}項目）。`);
  return {title,chunks:chunks.map(content=>`資料名：${title}\n\n${content}`)};
}async function createChunks(chunks, title, { embedder, fetcher, key }) {
  const result = [];
  for (let index = 0; index < chunks.length; index += EMBEDDING_CONCURRENCY) {
    const group = chunks.slice(index, index + EMBEDDING_CONCURRENCY);
    result.push(...await Promise.all(group.map(async (text, groupIndex) => ({
      chunk_index: index + groupIndex,
      content: text,
      embedding: await embedder(`task: search result | title: ${title} | text: ${text}`, { fetcher, key }),
      metadata: { title }
    }))));
  }
  return result;
}



export function createBookshelfHandler({env=process.env,fetcher=fetch,embedder=embed}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const fail=(code,error)=>res.status(code).json({error});
    if(req.method!=='POST') return fail(405,'この操作にはPOSTを使います。');
    const {RAG_IMPORT_TOKEN:token,SUPABASE_URL:url,SUPABASE_SECRET_KEY:key,GEMINI_API_KEY:gemini}=env;
    if(!token||!url||!key||!gemini) return fail(503,'本棚の接続設定が必要です。');
    const given=req.body?.token;
    if(typeof given!=='string'||Buffer.byteLength(given)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(given),Buffer.from(token))) return fail(401,'合言葉が違います。');
    const {action,id,name,content}=req.body||{};
    if(!['list','save','remove'].includes(action)) return fail(400,'操作を確認してください。');
    if(id!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail(400,'資料の指定が正しくありません。');
    let note;
    if(action==='save') {try {note=prepareMarkdown(name,content);} catch(e){return fail(400,e.message);}}
    if(action==='remove'&&!id) return fail(400,'資料を選んでください。');
    async function db(path,body) {
      const r=await fetcher(url+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
      if(!r.ok) throw new Error('DB_FAILED');
      return r.status===204?null:r.json().catch(()=>null);
    }
    try {
      if(action==='list') return res.status(200).json({documents:await db('knowledge_documents?metadata->>origin=eq.bookshelf&select=id,title,source_name,updated_at,metadata&order=updated_at.desc')});
      if(id) {
        const rows=await db(`knowledge_documents?id=eq.${id}&metadata->>origin=eq.bookshelf&select=id`);
        if(!rows?.length) return fail(404,'この資料が見つかりません。本棚を開き直してください。');
      }
      if(action==='remove') {
        await db('rpc/bookshelf_remove',{p_document_id:id});
        return res.status(200).json({message:'本棚から取り出しました。AIの検索対象から外れます。'});
      }
      const chunks=await Promise.all(note.chunks.map(async(text,index)=>({chunk_index:index,content:text,embedding:await embedder(`task: search result | title: ${note.title} | text: ${text}`,{fetcher,key:gemini}),metadata:{title:note.title}})));
      const documentId=id||randomUUID();
      await db('rpc/register_knowledge_document',{p_document_id:documentId,p_title:note.title,p_source_name:name,p_metadata:{origin:'bookshelf',shelf_removed:false,embedding_model:'gemini-embedding-2',dimensions:768},p_chunks:chunks});
      return res.status(200).json({id:documentId,message:'本棚にしまいました。AIが参照できる状態です。'});
    } catch {return fail(502,'処理結果を確認できませんでした。本棚を開き直して確認してください。');}
  };
}
export default createBookshelfHandler();
