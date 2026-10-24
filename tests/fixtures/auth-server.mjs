// Local-only Auth + catalog fixture. Never contacts Supabase, Resend, PostHog
// or any ad network. It serves a tiny nine-resort Colorado catalog so the hub,
// lineup and alert-account browser suites render real server-side data without
// a database, and supports fresh-confirmation / OAuth callback simulations.
import { createServer } from 'node:http';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'fixture@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z' };
const token = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'), Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test-signature'].join('.');
const sessionFor = (sessionUser) => ({access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user:sessionUser});
const session = () => sessionFor(user);
const freshUser = (provider) => ({...user, email_confirmed_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), app_metadata: {provider}});
const freshSession = (provider) => sessionFor(freshUser(provider));

const RESORTS = [
  ['00000000-0000-4000-8000-000000000001', 'Breckenridge', 'breckenridge', 'great'],
  ['00000000-0000-4000-8000-000000000002', 'Arapahoe Basin', 'arapahoe-basin', 'good'],
  ['00000000-0000-4000-8000-000000000003', 'Loveland Ski Area', 'loveland', 'good'],
  ['00000000-0000-4000-8000-000000000004', 'Keystone', 'keystone', 'fair'],
  ['00000000-0000-4000-8000-000000000005', 'Copper Mountain', 'copper-mountain', 'good'],
  ['00000000-0000-4000-8000-000000000006', 'Winter Park', 'winter-park', 'good'],
  ['00000000-0000-4000-8000-000000000007', 'Steamboat', 'steamboat', 'good'],
  ['00000000-0000-4000-8000-000000000008', 'Vail', 'vail', 'good'],
  ['00000000-0000-4000-8000-000000000009', 'Beaver Creek', 'beaver-creek', 'fair'],
].map(([id, name, slug, cond], index) => ({
  id, name, slug, state: 'CO', country: 'US', region: 'Colorado Rockies',
  lat: 39.4 + index / 10, lng: -106.0 + index / 10,
  website_url: `https://www.${slug}.example.invalid`,
  cam_page_url: `https://www.${slug}.example.invalid/webcams`,
  cond_rating: cond, snotel_station_id: `CO-00${index + 1}`,
  x_url: null, facebook_url: null, instagram_url: null, is_active: true,
  created_at: '2026-01-01T00:00:00Z',
}));

const SNOW_REPORTS = [
  { resort_id: RESORTS[0].id, base_depth: 42, new_snow_24h: 6, new_snow_48h: 9, trails_open: 27, trails_total: 34, lifts_open: 11, lifts_total: 14, conditions: 'powder,packed||Fresh overnight.', source: 'snotel', updated_at: '2026-10-24T13:00:00Z', swe_in: 11.2, pct_of_normal: 118, trend_7d: 'rising', outlook: 'more_snow', auto_cond_rating: 'great', snowing_now: false },
  { resort_id: RESORTS[1].id, base_depth: 40, new_snow_24h: 5, new_snow_48h: 7, trails_open: 8, trails_total: 11, lifts_open: 5, lifts_total: 8, conditions: 'powder||Cold and dry.', source: 'snotel', updated_at: '2026-10-24T12:00:00Z', swe_in: 9.8, pct_of_normal: 111, trend_7d: 'rising', outlook: 'more_snow', auto_cond_rating: 'good', snowing_now: false },
  { resort_id: RESORTS[2].id, base_depth: 38, new_snow_24h: 4, new_snow_48h: 6, trails_open: 6, trails_total: 10, lifts_open: 4, lifts_total: 7, conditions: 'packed||Wind buffed.', source: 'snotel', updated_at: '2026-10-24T12:00:00Z', swe_in: 9.1, pct_of_normal: 105, trend_7d: 'stable', outlook: 'stable', auto_cond_rating: 'good', snowing_now: false },
  { resort_id: RESORTS[3].id, base_depth: 35, new_snow_24h: 2, new_snow_48h: 3, trails_open: 12, trails_total: 20, lifts_open: 7, lifts_total: 12, conditions: 'packed||Groomers are firm.', source: 'snotel', updated_at: '2026-10-24T11:00:00Z', swe_in: 8.4, pct_of_normal: 98, trend_7d: 'stable', outlook: 'warming', auto_cond_rating: 'fair', snowing_now: false },
  ...[RESORTS[4], RESORTS[5], RESORTS[6], RESORTS[7], RESORTS[8]].map((resort, index) => ({
    resort_id: resort.id, base_depth: 30 - index, new_snow_24h: 1, new_snow_48h: 2,
    trails_open: 5, trails_total: 10, lifts_open: 3, lifts_total: 8,
    conditions: 'packed||Fixture report.', source: 'snotel', updated_at: '2026-10-24T10:00:00Z',
    swe_in: 7 - index / 10, pct_of_normal: 95, trend_7d: 'stable', outlook: 'stable',
    auto_cond_rating: 'fair', snowing_now: false,
  })),
];

const CAMS = [
  { id: '10000000-0000-4000-8000-000000000001', resort_id: RESORTS[0].id, name: 'Peak 8 Summit', elevation: '12,840', embed_type: 'youtube', embed_url: null, youtube_id: 'dQw4w9WgXcQ', is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: '2026-10-24T13:00:00Z', created_at: '2026-01-01T00:00:00Z', preview_rank: 1, card_preview: true },
  { id: '10000000-0000-4000-8000-000000000002', resort_id: RESORTS[0].id, name: 'Main Street', elevation: '9,600', embed_type: 'image', embed_url: 'https://example.invalid/breck-main.jpg', youtube_id: null, is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: '2026-10-24T13:00:00Z', created_at: '2026-01-01T00:00:00Z', preview_rank: 2, card_preview: true },
  { id: '10000000-0000-4000-8000-000000000003', resort_id: RESORTS[1].id, name: 'Summit Base', elevation: '13,050', embed_type: 'youtube', embed_url: null, youtube_id: 'M7lc1UVf-VE', is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: '2026-10-24T13:00:00Z', created_at: '2026-01-01T00:00:00Z', preview_rank: 1, card_preview: true },
  { id: '10000000-0000-4000-8000-000000000004', resort_id: RESORTS[2].id, name: 'Loveland Pass', elevation: '11,990', embed_type: 'youtube', embed_url: null, youtube_id: 'aqz-KE-bpKQ', is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: '2026-10-24T13:00:00Z', created_at: '2026-01-01T00:00:00Z', preview_rank: 1, card_preview: true },
  { id: '10000000-0000-4000-8000-000000000005', resort_id: RESORTS[3].id, name: 'River Run', elevation: '9,280', embed_type: 'image', embed_url: 'https://example.invalid/keystone-river.jpg', youtube_id: null, is_active: true, consecutive_failures: 0, auto_disabled: false, last_checked_at: '2026-10-24T13:00:00Z', created_at: '2026-01-01T00:00:00Z', preview_rank: 1, card_preview: true },
];

let requests = [];
let favorites = [];
let failFavoriteWrites = 0;
let alertSubscriber = null;

/** Minimal PostgREST `eq.` / `in.(…)` filtering for the tables this fixture serves. */
function filterRows(rows, url) {
  let out = [...rows];
  for (const [key, value] of url.searchParams) {
    if (!['slug','id','resort_id','is_active','item_type','item_id','user_id','email'].includes(key)) continue;
    if (value.startsWith('eq.')) {
      const expected = value.slice(3);
      out = out.filter((row) => String(row[key]) === expected);
    } else if (value.startsWith('in.(')) {
      // PostgREST sends both `in.(uuid,uuid)` (supabase-js) and the quoted
      // service-role form; accept either.
      const ids = new Set(
        value
          .slice(4, -1)
          .split(',')
          .map((part) => part.trim().replace(/^"|"$/g, ''))
          .filter(Boolean),
      );
      out = out.filter((row) => ids.has(String(row[key])));
    }
  }
  return out;
}

createServer(async (req,res) => {
  res.setHeader('X-Supabase-Api-Version','2024-01-01');
  res.setHeader('Access-Control-Expose-Headers','x-supabase-api-version');
  // Echo the page origin: the dev server canonicalises to localhost while the
  // fixture itself is reached at 127.0.0.1, so a fixed origin would block CORS.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version,accept-profile,content-profile,prefer');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const url = new URL(req.url,'http://127.0.0.1:3119');
  let body='';for await(const c of req)body+=c;const data=body?JSON.parse(body):{};
  const send=(status,value,headers={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(value));};

  if(url.pathname==='/health')return send(200,{ok:true});
  if(url.pathname==='/_test/reset'){
    requests=[];favorites=[];failFavoriteWrites=0;alertSubscriber=null;
    return send(200,{});
  }
  if(url.pathname==='/_test/requests')return send(200,requests);
  if(url.pathname==='/_test/favorites')return send(200,favorites);
  if(url.pathname==='/_test/fail-favorite-writes'&&req.method==='POST'){
    failFavoriteWrites=Math.max(0,Number(data.count)||0);
    return send(200,{failFavoriteWrites});
  }

  if(req.method==='GET'&&url.pathname.startsWith('/rest/v1/')) {
    requests.push({method:'GET',path:url.pathname,query:Object.fromEntries(url.searchParams)});
    if(url.pathname==='/rest/v1/resorts')return send(200,filterRows(RESORTS,url));
    if(url.pathname==='/rest/v1/latest_snow_reports')return send(200,filterRows(SNOW_REPORTS,url));
    if(url.pathname==='/rest/v1/cams')return send(200,filterRows(CAMS,url));
    if(url.pathname==='/rest/v1/user_favorites')return send(200,filterRows(favorites,url));
    if(url.pathname==='/rest/v1/alert_subscribers')return send(200,filterRows(alertSubscriber?[alertSubscriber]:[],url));
    return send(200,[]);
  }

  if(req.method==='POST'&&url.pathname==='/rest/v1/user_favorites') {
    const rows = Array.isArray(data) ? data : [data];
    requests.push({method:'POST',path:url.pathname,body:data});
    if(failFavoriteWrites>0){
      failFavoriteWrites-=1;
      return send(500,{code:'fixture_failure',message:'The fixture was asked to fail this insert.'});
    }
    for(const row of rows) {
      if(!row||typeof row.item_id!=='string')continue;
      if(favorites.some(f=>f.item_id===row.item_id&&f.item_type===row.item_type)){
        return send(409,{code:'23505',message:'duplicate key value violates unique constraint'});
      }
      favorites.push({id:`favorite-${favorites.length+1}`,user_id:row.user_id,item_type:row.item_type,item_id:row.item_id,created_at:'2026-10-24T13:30:00Z'});
    }
    return send(201,[]);
  }

  if(req.method==='DELETE'&&url.pathname==='/rest/v1/user_favorites') {
    const itemId = url.searchParams.get('item_id')?.replace(/^eq\./,'');
    const itemType = url.searchParams.get('item_type')?.replace(/^eq\./,'');
    requests.push({method:'DELETE',path:url.pathname,query:Object.fromEntries(url.searchParams)});
    favorites=favorites.filter(f=>!(f.item_id===itemId && (!itemType || f.item_type===itemType)));
    res.writeHead(204);res.end();return;
  }

  // Service-role alert writes (the route handler runs on the dev server).
  if(req.method==='POST'&&url.pathname==='/rest/v1/alert_subscribers') {
    requests.push({method:'POST',path:url.pathname,body:data});
    alertSubscriber={id:'sub-fixture-1',email:data.email,manage_token:'fixture-manage-token'};
    return send(201,[alertSubscriber]);
  }
  if(req.method==='POST'&&url.pathname==='/rest/v1/alert_preferences') {
    requests.push({method:'POST',path:url.pathname,body:data});
    return send(201,[]);
  }

  requests.push({method:req.method,path:url.pathname,scope:url.searchParams.get('scope'),type:data.type,hasPassword:typeof data.password==='string',passwordLength:data.password?.length,email:data.email});
  const authenticated=req.headers.authorization===`Bearer ${token}`;

  if(url.pathname==='/auth/v1/settings') return send(200,{external:{email:true,google:true}});
  if(url.pathname==='/auth/v1/authorize') {
    // Simulate the provider round trip: Supabase would redirect to the app's
    // callback with a code. The app never leaves the fixture origin here.
    const redirectTo=url.searchParams.get('redirect_to');
    if(!redirectTo)return send(400,{message:'Missing redirect_to'});
    const target=new URL(redirectTo);
    target.searchParams.set('code','fresh-oauth');
    res.writeHead(302,{Location:target.toString()});
    res.end();
    return;
  }
  if(url.pathname==='/auth/v1/user') {
    if(!authenticated)return send(401,{code:'bad_jwt',message:'Invalid fixture session'});
    if(req.method==='PUT'&&data.password==='password')return send(422,{code:'weak_password',message:'Unsafe provider details'});
    return send(200,user);
  }
  if(url.pathname==='/auth/v1/token'){
    if(url.searchParams.get('grant_type')==='pkce' || typeof data.auth_code==='string') {
      return send(200,freshSession('google'));
    }
    if(data.email==='unconfirmed@example.invalid')return send(400,{code:'email_not_confirmed',msg:'Email not confirmed'});
    if(data.email!=='fixture@example.invalid')return send(400,{code:'invalid_credentials',msg:'Private backend diagnostic'});
    return send(200,session());
  }
  if(url.pathname==='/auth/v1/signup')return send(200,{user,session:null});
  if(url.pathname==='/auth/v1/resend'||url.pathname==='/auth/v1/otp'||url.pathname==='/auth/v1/recover')return send(200,{});
  if(url.pathname==='/auth/v1/verify'){
    if(data.token_hash==='fresh-confirm'||data.token==='fresh-confirm')return send(200,freshSession('email'));
    return data.token==='123456'?send(200,session()):send(403,{code:'otp_expired',msg:'Private token diagnostic'});
  }
  if(url.pathname==='/auth/v1/logout'){res.writeHead(204);res.end();return;}
  return send(404,{message:'Unknown fixture endpoint'});
}).listen(3119,'127.0.0.1');
