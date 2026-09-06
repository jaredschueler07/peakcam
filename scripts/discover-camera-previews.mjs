import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parse } from "dotenv";
const env = parse(fs.readFileSync(".env.local"));
(async()=>{
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
 const {data,error}=await client.from('cams').select('embed_url').eq('is_active',true).eq('embed_type','iframe').ilike('embed_url','%roundshot.com%');if(error)throw error;
 const results={};
 for(const row of data){
  const source=new URL(row.embed_url);if(!source.hostname.endsWith('.roundshot.com'))continue;
  try{
   const res=await fetch(source,{signal:AbortSignal.timeout(10000)});if(!res.ok)continue;
   const html=await res.text();const thumb=html.match(/<meta[^>]+(?:name|property)="twitter:image"[^>]+content="([^"]+)"/i)?.[1];if(!thumb)continue;
   const url=new URL(thumb,source);if(url.protocol!=='https:'||url.hostname!==source.hostname)continue;
   results[source.href]=url.href;
  }catch{console.log('No thumbnail:',source.href);}
 }
 fs.writeFileSync('scripts/data/camera-previews/roundshot.json',JSON.stringify(results,null,2)+'\n');
 console.log('Provider-declared thumbnail mappings:',Object.keys(results).length);
})().catch(e=>{console.error(e.message);process.exitCode=1});
