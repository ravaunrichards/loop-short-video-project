import http from 'node:http';
import { randomUUID, randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCb);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');
const PORT = Number(process.env.PORT || 3000);
const APP_SECRET = process.env.APP_SECRET || 'development-only-change-this-secret';
const MAX_UPLOAD = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 100)) * 1024 * 1024;
const MIME_EXT = new Map([['video/mp4','.mp4'],['video/webm','.webm'],['video/quicktime','.mov'],['video/x-m4v','.m4v']]);
let db;

async function loadDb() {
  await mkdir(DATA, { recursive: true }); await mkdir(UPLOADS, { recursive: true });
  try { db = JSON.parse(await readFile(DB_FILE, 'utf8')); }
  catch { db = { users: [], videos: [], follows: [], likes: [], comments: [] }; await saveDb(); }
  for (const k of ['users','videos','follows','likes','comments']) if (!Array.isArray(db[k])) db[k] = [];
}
async function saveDb() { await writeFile(DB_FILE, JSON.stringify(db, null, 2)); }
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(body)); };
const publicUser = u => ({ id:u.id, username:u.username, displayName:u.displayName, bio:u.bio || '', createdAt:u.createdAt, followers:db.follows.filter(x=>x.followingId===u.id).length, following:db.follows.filter(x=>x.followerId===u.id).length });
function tokenFor(userId) { const payload = Buffer.from(JSON.stringify({ sub:userId, exp:Date.now()+7*24*60*60*1000 })).toString('base64url'); const sig = createHmac('sha256', APP_SECRET).update(payload).digest('base64url'); return `${payload}.${sig}`; }
function userFromToken(req) { const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : ''; const [payload,sig] = t.split('.'); if (!payload || !sig) return null; const expected = createHmac('sha256', APP_SECRET).update(payload).digest(); let actual; try { actual=Buffer.from(sig,'base64url'); } catch { return null; } if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) return null; try { const p=JSON.parse(Buffer.from(payload,'base64url').toString()); return p.exp>Date.now() ? db.users.find(u=>u.id===p.sub) || null : null; } catch { return null; } }
async function readBody(req, max=2*1024*1024) { const chunks=[]; let size=0; for await (const chunk of req) { size+=chunk.length; if(size>max) throw Object.assign(new Error('Request too large'),{status:413}); chunks.push(chunk); } return Buffer.concat(chunks); }
async function readJson(req) { const b=await readBody(req); try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'),{status:400}); } }
function cleanText(v, max=500) { return String(v ?? '').trim().slice(0,max); }
function routeMatch(pathname, regex) { const m=pathname.match(regex); return m ? m : null; }
async function handle(req,res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p=url.pathname; const method=req.method;
  try {
    if (method==='GET' && p==='/api/health') return json(res,200,{ok:true,service:'Loop API',time:new Date().toISOString()});
    if (method==='POST' && p==='/api/auth/register') {
      const b=await readJson(req); const username=cleanText(b.username,24).toLowerCase(); const displayName=cleanText(b.displayName || b.username,40); const password=String(b.password || '');
      if(!/^[a-z0-9_]{3,24}$/.test(username)) return json(res,400,{error:'Username must be 3–24 characters: letters, numbers, underscores.'});
      if(password.length<8 || password.length>200) return json(res,400,{error:'Password must be at least 8 characters.'});
      if(db.users.some(u=>u.username===username)) return json(res,409,{error:'That username is already taken.'});
      const salt=randomBytes(16).toString('hex'); const hash=(await scrypt(password,salt,64)).toString('hex');
      const user={id:randomUUID(),username,displayName:displayName||username,passwordHash:hash,salt,bio:'',createdAt:new Date().toISOString()}; db.users.push(user); await saveDb();
      return json(res,201,{token:tokenFor(user.id),user:publicUser(user)});
    }
    if (method==='POST' && p==='/api/auth/login') {
      const b=await readJson(req); const username=cleanText(b.username,24).toLowerCase(); const user=db.users.find(u=>u.username===username);
      if(!user || typeof b.password!=='string') return json(res,401,{error:'Incorrect username or password.'});
      const hash=await scrypt(b.password,user.salt,64); const saved=Buffer.from(user.passwordHash,'hex'); if(hash.length!==saved.length || !timingSafeEqual(hash,saved)) return json(res,401,{error:'Incorrect username or password.'});
      return json(res,200,{token:tokenFor(user.id),user:publicUser(user)});
    }
    if (method==='GET' && p==='/api/me') { const u=userFromToken(req); return u ? json(res,200,{user:publicUser(u)}) : json(res,401,{error:'Sign in to continue.'}); }
    if (method==='PATCH' && p==='/api/me') { const u=userFromToken(req); if(!u) return json(res,401,{error:'Sign in to continue.'}); const b=await readJson(req); if(b.displayName!==undefined) u.displayName=cleanText(b.displayName,40)||u.username; if(b.bio!==undefined) u.bio=cleanText(b.bio,160); await saveDb(); return json(res,200,{user:publicUser(u)}); }
    if (method==='GET' && p==='/api/videos') {
      const me=userFromToken(req); const mode=url.searchParams.get('feed')==='following'?'following':'for-you';
      let videos=[...db.videos]; if(mode==='following' && me){ const ids=new Set(db.follows.filter(f=>f.followerId===me.id).map(f=>f.followingId)); videos=videos.filter(v=>ids.has(v.userId)); }
      videos.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      return json(res,200,{videos:videos.slice(0,100).map(v=>({...v,liked:!!me&&db.likes.some(l=>l.videoId===v.id&&l.userId===me.id),likeCount:db.likes.filter(l=>l.videoId===v.id).length,commentCount:db.comments.filter(c=>c.videoId===v.id).length,creator:publicUser(db.users.find(u=>u.id===v.userId)||{id:'',username:'unknown',displayName:'Unknown',createdAt:''}),following:!!me&&db.follows.some(f=>f.followerId===me.id&&f.followingId===v.userId)}))});
    }
    if (method==='POST' && p==='/api/videos/upload') {
      const u=userFromToken(req); if(!u) return json(res,401,{error:'Sign in before uploading.'});
      const ct=req.headers['content-type']||''; const boundaryMatch=ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i); if(!ct.toLowerCase().startsWith('multipart/form-data') || !boundaryMatch) return json(res,400,{error:'Upload must use multipart/form-data.'});
      const boundary=boundaryMatch[1]||boundaryMatch[2]; const raw=await readBody(req,MAX_UPLOAD+1024*1024); const marker=Buffer.from(`--${boundary}`); const parts=[]; let cursor=0;
      while(true){ const start=raw.indexOf(marker,cursor); if(start<0) break; let partStart=start+marker.length; if(raw.subarray(partStart,partStart+2).equals(Buffer.from('--'))) break; if(raw.subarray(partStart,partStart+2).equals(Buffer.from('\r\n'))) partStart+=2; const next=raw.indexOf(marker,partStart); if(next<0) break; let part=raw.subarray(partStart,next); if(part.subarray(-2).toString()==='\r\n') part=part.subarray(0,-2); const sep=part.indexOf(Buffer.from('\r\n\r\n')); if(sep>=0) parts.push({headers:part.subarray(0,sep).toString('utf8'),data:part.subarray(sep+4)}); cursor=next; }
      let file=null, caption='', title='';
      for(const part of parts){ const disp=part.headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1]||''; const name=disp.match(/name="([^"]+)"/)?.[1]; const filename=disp.match(/filename="([^"]*)"/)?.[1]; if(filename!==undefined && filename!==''){ const mime=part.headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase()||''; if(!MIME_EXT.has(mime)) return json(res,415,{error:'Supported formats: MP4, WebM, MOV and M4V.'}); file={data:part.data,mime,filename}; } else if(name==='caption') caption=part.data.toString('utf8').trim().slice(0,500); else if(name==='title') title=part.data.toString('utf8').trim().slice(0,100); }
      if(!file || !file.data.length) return json(res,400,{error:'Choose a video file first.'}); if(file.data.length>MAX_UPLOAD) return json(res,413,{error:`Video is larger than the ${Math.floor(MAX_UPLOAD/1024/1024)} MB limit.`});
      const id=randomUUID(); const ext=MIME_EXT.get(file.mime); await writeFile(path.join(UPLOADS,id+ext),file.data,{flag:'wx'}); const video={id,userId:u.id,title,caption,videoUrl:`/uploads/${id}${ext}`,mimeType:file.mime,size:file.data.length,createdAt:new Date().toISOString()}; db.videos.push(video); await saveDb(); return json(res,201,{video:{...video,creator:publicUser(u),likeCount:0,commentCount:0,liked:false}});
    }
    let m=routeMatch(p,/^\/api\/videos\/([\w-]+)\/like$/);
    if(method==='POST'&&m){ const u=userFromToken(req); if(!u)return json(res,401,{error:'Sign in to like videos.'}); const videoId=m[1]; if(!db.videos.some(v=>v.id===videoId))return json(res,404,{error:'Video not found.'}); const i=db.likes.findIndex(l=>l.videoId===videoId&&l.userId===u.id); let liked; if(i>=0){db.likes.splice(i,1);liked=false;}else{db.likes.push({videoId,userId:u.id});liked=true;} await saveDb(); return json(res,200,{liked,likeCount:db.likes.filter(l=>l.videoId===videoId).length}); }
    m=routeMatch(p,/^\/api\/videos\/([\w-]+)\/comments$/);
    if(m&&method==='GET'){ if(!db.videos.some(v=>v.id===m[1]))return json(res,404,{error:'Video not found.'}); return json(res,200,{comments:db.comments.filter(c=>c.videoId===m[1]).map(c=>({...c,user:publicUser(db.users.find(u=>u.id===c.userId)||{id:'',username:'unknown',displayName:'Unknown',createdAt:''})}))}); }
    if(m&&method==='POST'){ const u=userFromToken(req); if(!u)return json(res,401,{error:'Sign in to comment.'}); if(!db.videos.some(v=>v.id===m[1]))return json(res,404,{error:'Video not found.'}); const b=await readJson(req); const text=cleanText(b.text,500); if(!text)return json(res,400,{error:'Comment cannot be empty.'}); const c={id:randomUUID(),videoId:m[1],userId:u.id,text,createdAt:new Date().toISOString()}; db.comments.push(c); await saveDb(); return json(res,201,{comment:{...c,user:publicUser(u)}}); }
    if(method==='GET' && p==='/api/users'){ const me=userFromToken(req); const users=db.users.map(u=>({...publicUser(u),following:!!me&&db.follows.some(f=>f.followerId===me.id&&f.followingId===u.id)})).sort((a,b)=>b.followers-a.followers || a.username.localeCompare(b.username)); return json(res,200,{users}); }
    m=routeMatch(p,/^\/api\/users\/([\w-]+)$/);
    if(m&&method==='GET'){ const u=db.users.find(x=>x.id===m[1]||x.username===m[1]); if(!u)return json(res,404,{error:'Creator not found.'}); return json(res,200,{user:publicUser(u),videos:db.videos.filter(v=>v.userId===u.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(v=>({...v,likeCount:db.likes.filter(l=>l.videoId===v.id).length,commentCount:db.comments.filter(c=>c.videoId===v.id).length}))}); }
    m=routeMatch(p,/^\/api\/users\/([\w-]+)\/follow$/);
    if(m&&method==='POST'){ const me=userFromToken(req); if(!me)return json(res,401,{error:'Sign in to follow creators.'}); const target=db.users.find(u=>u.id===m[1]); if(!target)return json(res,404,{error:'Creator not found.'}); if(target.id===me.id)return json(res,400,{error:'You cannot follow yourself.'}); const i=db.follows.findIndex(f=>f.followerId===me.id&&f.followingId===target.id); let following; if(i>=0){db.follows.splice(i,1);following=false;}else{db.follows.push({followerId:me.id,followingId:target.id});following=true;} await saveDb(); return json(res,200,{following,followers:db.follows.filter(f=>f.followingId===target.id).length}); }
    if(method==='GET' && p.startsWith('/uploads/')){ const name=path.basename(p); const file=path.join(UPLOADS,name); if(!/^[\w-]+\.(mp4|webm|mov|m4v)$/i.test(name))return json(res,404,{error:'Not found.'}); let info; try{info=await stat(file);}catch{return json(res,404,{error:'Not found.'});} const range=req.headers.range; const mime=[...MIME_EXT.entries()].find(([,ext])=>name.endsWith(ext))?.[0]||'application/octet-stream'; if(range){const mm=range.match(/bytes=(\d*)-(\d*)/); if(!mm)return json(res,416,{error:'Invalid byte range.'}); let start=mm[1]?Number(mm[1]):Math.max(0,info.size-Number(mm[2])); let end=mm[2]?Number(mm[2]):info.size-1; if(start>=info.size||end>=info.size||start>end){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});return res.end();} res.writeHead(206,{'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${info.size}`,'X-Content-Type-Options':'nosniff'}); const {createReadStream}=await import('node:fs'); return createReadStream(file,{start,end}).pipe(res); } res.writeHead(200,{'Content-Type':mime,'Content-Length':info.size,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'}); const {createReadStream}=await import('node:fs'); return createReadStream(file).pipe(res); }
    if(method==='GET' && !p.startsWith('/api/')){ const rel=p==='/'?'index.html':decodeURIComponent(p).replace(/^\/+/, ''); const target=path.resolve(PUBLIC,rel); if(!target.startsWith(PUBLIC+path.sep)&&target!==path.join(PUBLIC,'index.html'))return json(res,403,{error:'Forbidden'}); try{const data=await readFile(target); const ext=path.extname(target); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'}; res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"}); return res.end(data);}catch{return json(res,404,{error:'Not found'});} }
    return json(res,404,{error:'Route not found.'});
  } catch(e) { if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'Server error.'}); else res.destroy(); if(!e.status) console.error(e); }
}
export async function createServer() { await loadDb(); return http.createServer(handle); }
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) createServer().then(server=>server.listen(PORT,()=>console.log(`Loop is running at http://localhost:${PORT}`)));
