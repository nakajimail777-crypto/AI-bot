import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareNote, embed } from '../scripts/prepare-knowledge.mjs';

const DOCUMENT_ID='6c0b9c29-2236-5cef-9ce3-173f38d72ba2';
const NOTE_PATH=resolve(process.cwd(),'knowledge/ryuhijutsu-combination-interpretation-notes.md');

function sameSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a=Buffer.from(provided), b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
function fail(res,status,error) { return res.status(status).json({error}); }

export function createImportHandler({fetcher=fetch, env=process.env, loadNote=()=>readFile(NOTE_PATH,'utf8')}={}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST') return fail(res,405,'この操作にはPOSTを使います。');
    const { RAG_IMPORT_TOKEN: token, SUPABASE_URL:url, SUPABASE_SECRET_KEY:secret, GEMINI_API_KEY:geminiKey }=env;
    if(!token || !url || !secret || !geminiKey) return fail(res,503,'登録の準備ができていません。設定を確認してください。');
    if(!sameSecret(req.body?.token,token)) return fail(res,401,'登録用の合言葉が違います。');
    try {
      const note=prepareNote(await loadNote());
      const chunks=[];
      for(const chunk of note.chunks) {
        const vector=await embed(`task: search result | title: ${chunk.title} | text: ${chunk.content}`,{fetcher,key:geminiKey});
        chunks.push({chunk_index:chunk.index,content:chunk.content,embedding:vector,metadata:{source_sha256:note.sha256,title:chunk.title}});
      }
      const response=await fetcher(url+'/rest/v1/rpc/register_knowledge_document',{
        method:'POST',
        headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
        body:JSON.stringify({
          p_document_id:DOCUMENT_ID,p_title:note.title,p_source_name:note.source_name,
          p_metadata:{source_sha256:note.sha256,embedding_model:'gemini-embedding-2',dimensions:768,origin:'user-edited interpretation note'},
          p_chunks:chunks
        }),signal:AbortSignal.timeout(30000)
      });
      if(!response.ok) throw new Error('DATABASE_WRITE_FAILED');
      return res.status(200).json({ok:true,chunkCount:chunks.length,message:'解釈ノートを参考資料に登録しました。'});
    } catch(error) {
      console.error('combination_note_import_failed',{code:error?.message});
      return fail(res,502,'登録を完了できませんでした。ノートは変更されていません。少し時間をおいてもう一度お試しください。');
    }
  };
}

export default createImportHandler();
