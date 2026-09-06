// Local-only Auth protocol fixture. Never contacts Supabase or sends mail.
import { createServer } from 'node:http';
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z' };
const token = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.');
const session = () => ({access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user});
let requests=[];
createServer(async (req,res) => {
  res.setHeader('X-Supabase-Api-Version','2024-01-01');
  res.setHeader('Access-Control-Expose-Headers','x-supabase-api-version');
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3118');
  res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const url = new URL(req.url,'http://127.0.0.1:3119');
  let body='';for await(const c of req)body+=c;const data=body?JSON.parse(body):{};
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/health')return send(200,{ok:true});
  if(url.pathname==='/_test/reset'){requests=[];return send(200,{});}
  if(url.pathname==='/_test/requests')return send(200,requests);
  requests.push({method:req.method,path:url.pathname,scope:url.searchParams.get('scope'),type:data.type,hasPassword:typeof data.password==='string',passwordLength:data.password?.length,email:data.email});
  const authenticated=req.headers.authorization===`Bearer ${token}`;
  if(url.pathname==='/auth/v1/user') {
    if(!authenticated)return send(401,{code:'bad_jwt',message:'Invalid fixture session'});
    if(req.method==='PUT'&&data.password==='password')return send(422,{code:'weak_password',message:'Unsafe provider details'});
    return send(200,user);
  }
  if(url.pathname==='/auth/v1/token'){
    if(data.email==='unconfirmed@example.invalid')return send(400,{code:'email_not_confirmed',msg:'Email not confirmed'});
    if(data.email!=='fixture@example.invalid')return send(400,{code:'invalid_credentials',msg:'Private backend diagnostic'});
    return send(200,session());
  }
  if(url.pathname==='/auth/v1/signup')return send(200,{user,session:null});
  if(url.pathname==='/auth/v1/resend'||url.pathname==='/auth/v1/otp'||url.pathname==='/auth/v1/recover')return send(200,{});
  if(url.pathname==='/auth/v1/verify')return data.token==='123456'?send(200,session()):send(403,{code:'otp_expired',msg:'Private token diagnostic'});
  if(url.pathname==='/auth/v1/logout'){res.writeHead(204);res.end();return;}
  return send(404,{message:'Unknown fixture endpoint'});
}).listen(3119,'127.0.0.1');
