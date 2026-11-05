import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const scrypt=promisify(scryptCallback);
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const sha=s=>createHash('sha256').update(s).digest('hex');
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new HttpError(status,message);};
const text=(v,min,max,label)=>{if(typeof v!=='string'||v.trim().length<min||v.trim().length>max)fail(400,`${label}을(를) 확인해 주세요.`);return v.trim();};
const integer=(v,min,max,label)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,`${label}을(를) 확인해 주세요.`);return v;};
const checkedDate=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'2000-01-01'||v>'2100-12-31')fail(400,'날짜를 확인해 주세요.');const d=new Date(v+'T12:00:00Z');if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==v)fail(400,'날짜를 확인해 주세요.');return v;};
const checkedMonth=v=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v||'')||v<'2000-01'||v>'2100-12')fail(400,'조회할 월을 확인해 주세요.');return v;};
const birthInput=v=>{if(typeof v!=='string'||!/^\d{6}$/.test(v))fail(400,'생년월일은 숫자 6자리로 입력해 주세요.');const y=2000+Number(v.slice(0,2)),m=Number(v.slice(2,4)),d=Number(v.slice(4,6)),date=new Date(Date.UTC(y,m-1,d));if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)fail(400,'생년월일을 확인해 주세요. 예: 900101');return v;};
async function passwordHash(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,32);return salt+':'+key.toString('hex');}
async function passwordMatches(password,hash){const [salt,expected]=hash.split(':');const actual=await scrypt(password,salt,32);return timingSafeEqual(actual,Buffer.from(expected,'hex'));}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)fail(413,'입력 내용이 너무 깁니다.');}try{return JSON.parse(raw);}catch{fail(400,'입력 형식을 확인해 주세요.');}}

export async function createApp(config={}){
 const production=config.production??process.env.NODE_ENV==='production';
 const keyHex=config.encryptionKey??process.env.DATA_ENCRYPTION_KEY;
 const adminPassword=config.adminPassword??process.env.ADMIN_PASSWORD;
 const privacyNotice=config.privacyNotice??process.env.PRIVACY_NOTICE??'';
 const rrnEnabled=config.rrnEnabled??process.env.COLLECT_RRN==='true';
 const rrnBasis=config.rrnBasis??process.env.RRN_COLLECTION_BASIS??'';
 const origin=config.origin??process.env.APP_ORIGIN??process.env.RENDER_EXTERNAL_URL??'';
 const trustProxy=config.trustProxy??process.env.TRUST_PROXY==='true';
 if(!/^[a-f0-9]{64}$/i.test(keyHex||''))throw new Error('DATA_ENCRYPTION_KEY must contain 64 hex characters. Run npm run setup.');
 if(typeof adminPassword!=='string'||adminPassword.length<8||adminPassword.length>128)throw new Error('ADMIN_PASSWORD must contain 8–128 characters.');
 if(production&&(!origin.startsWith('https://')||new URL(origin).origin!==origin))throw new Error('APP_ORIGIN must be the exact HTTPS origin.');
 if(rrnEnabled&&!rrnBasis.trim())throw new Error('RRN_COLLECTION_BASIS is required when COLLECT_RRN=true.');
 const key=Buffer.from(keyHex,'hex');
 const encrypt=(data,aad)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const bytes=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');};
 const decrypt=(raw,aad)=>{const bytes=Buffer.from(raw,'base64'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());};
 const digest=v=>createHmac('sha256',key).update(v).digest('hex');
 const dbPath=config.dbPath??process.env.DB_PATH??'./data/attendance.sqlite';
 if(dbPath!==':memory:')mkdirSync(dirname(resolve(dbPath)),{recursive:true});
 const db=new DatabaseSync(dbPath);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY,phone_key TEXT NOT NULL UNIQUE,pin_hash TEXT NOT NULL,personal TEXT NOT NULL,daily_rate INTEGER,created_at TEXT NOT NULL,consented_at TEXT NOT NULL,notice_version TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS records(worker_id TEXT NOT NULL REFERENCES workers(id),date TEXT NOT NULL,units INTEGER NOT NULL CHECK(units>=0 AND units<=10000),rate INTEGER,details TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(worker_id,date));
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,worker_id TEXT REFERENCES workers(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,target_id TEXT,created_at TEXT NOT NULL);`);
 const adminHash=await passwordHash(adminPassword);
 const probe=db.prepare('SELECT id,personal FROM workers LIMIT 1').get();
 if(probe){try{decrypt(probe.personal,'worker:'+probe.id);}catch{db.close();throw new Error('DATA_ENCRYPTION_KEY does not match the existing database. Restore the original key.');}}
 // Existing workers and records remain intact; legacy accounts set their new credentials while signed in.
 if(!db.prepare('PRAGMA table_info(workers)').all().some(c=>c.name==='login_key'))db.exec('ALTER TABLE workers ADD COLUMN login_key TEXT');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS workers_login_key ON workers(login_key); PRAGMA user_version=2;');
 db.prepare("DELETE FROM sessions WHERE role='admin'").run();
 const audit=(action,targetId=null)=>db.prepare('INSERT INTO audit(action,target_id,created_at) VALUES(?,?,?)').run(action,targetId,new Date().toISOString());
 function limit(req,action,max=8){
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1).trim();
  const now=Date.now(),ip=trustProxy&&isIP(forwarded)?forwarded:req.socket.remoteAddress||'unknown',k=digest(action+':'+ip);
  db.prepare('DELETE FROM attempts WHERE expires_at < ?').run(now);
  const prior=db.prepare('SELECT count FROM attempts WHERE key=?').get(k);
  if(prior&&prior.count>=max)fail(429,'시도가 많습니다. 15분 후 다시 해주세요.');
  db.prepare('INSERT INTO attempts(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(k,now+15*60*1000);
 }
 const cookieName=role=>production?'__Host-te-'+role:'te-'+role;
 const cookie=(role,token,maxAge)=>cookieName(role)+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(production?'; Secure':'');
 function issue(res,role,workerId=null){
  const token=randomBytes(32).toString('hex'),ttl=role==='admin'?1200:2592000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token),role,workerId,Date.now()+ttl*1000);
  res.setHeader('Set-Cookie',cookie(role,token,ttl));
 }
 function session(req,role,required=true){
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')));
  const token=cookies[cookieName(role)];
  const s=token&&/^[a-f0-9]{64}$/.test(token)?db.prepare('SELECT * FROM sessions WHERE token_hash=? AND role=? AND expires_at>?').get(sha(token),role,Date.now()):null;
  if(!s&&required)fail(401,role==='admin'?'관리자 인증이 필요합니다.':'다시 로그인해 주세요.');
  return s||null;
 }
 function workerView(w,admin=false){
  const p=decrypt(w.personal,'worker:'+w.id);
  return {id:w.id,name:p.name,birthDate:p.birthDate||null,needsLoginSetup:!w.login_key,phone:p.phone,bank:p.bank,account:p.account.replace(/.(?=.{4})/g,'•'),rrn:p.rrn?p.rrn.slice(0,6)+'-•••••••':'미등록',dailyRate:w.daily_rate,createdAt:w.created_at,...(admin?{hasRrn:Boolean(p.rrn)}:{})};
 }
 function recordView(r){return {date:r.date,units:r.units/100,dailyRate:r.rate,amount:r.units===0?0:r.rate===null?null:Math.round(r.units*r.rate/100),...decrypt(r.details,'record:'+r.worker_id+':'+r.date),updatedAt:r.updated_at};}
 function recordsFor(id,month){return db.prepare('SELECT * FROM records WHERE worker_id=? AND date>=? AND date<=? ORDER BY date').all(id,month+'-01',month+'-31').map(recordView);}
 const personalInput=p=>{
  const name=text(p.name,2,50,'이름'),phone=text(p.phone,10,20,'전화번호').replace(/\D/g,'');
  if(!/^01[016789]\d{7,8}$/.test(phone))fail(400,'휴대폰 번호를 확인해 주세요.');
  const bank=text(p.bank,2,30,'은행'),account=text(p.account,5,40,'계좌번호').replace(/[\s-]/g,'');
  if(!/^\d{5,30}$/.test(account))fail(400,'계좌번호는 숫자로 입력해 주세요.');
  let rrn='';if(rrnEnabled){rrn=text(p.rrn,13,14,'주민등록번호').replace(/-/g,'');if(!/^\d{13}$/.test(rrn))fail(400,'주민등록번호 13자리를 확인해 주세요.');}
  const birthDate=birthInput(p.birthDate);
  if(rrn&&rrn.slice(0,6)!==birthDate)fail(400,'생년월일과 주민등록번호 앞 6자리가 다릅니다.');
  return {name,phone,bank,account,rrn,birthDate};
 };
 const pinInput=p=>{if(typeof p!=='string'||!/^\d{4}$/.test(p))fail(400,'비밀번호는 숫자 4자리로 입력해 주세요.');return p;};
 const loginKey=(birth,pin)=>digest('login:'+birth+':'+pin);
 const loginConflict=()=>fail(409,'같은 생년월일에 이미 사용 중인 비밀번호입니다. 다른 4자리 비밀번호를 정해 주세요.');
 const handler=async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  try{
   const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
   if(path==='/healthz')return json(res,200,{ok:true});
   if(path.startsWith('/api/')){
    if(!['GET','POST','PUT','DELETE'].includes(method))fail(405,'지원하지 않는 요청입니다.');
    if(method!=='GET'){
     const expected=origin||'http://'+req.headers.host;
     if(req.headers.origin!==expected||req.headers['x-requested-with']!=='TOTAL-ENG'||!req.headers['content-type']?.startsWith('application/json'))fail(403,'허용되지 않은 요청입니다.');
    }
    if(path==='/api/config'&&method==='GET')return json(res,200,{rrnEnabled,rrnBasis:rrnEnabled?rrnBasis:'',privacyNotice,registrationEnabled:Boolean(privacyNotice.trim()),version:'1.1.0'});
    if(path==='/api/session'&&method==='GET'){
     const s=session(req,'worker',false),a=session(req,'admin',false),w=s?db.prepare('SELECT * FROM workers WHERE id=?').get(s.worker_id):null;
     return json(res,200,{worker:w?workerView(w):null,admin:Boolean(a)});
    }
    if(path==='/api/register'&&method==='POST'){
     limit(req,'register',10);const p=await body(req);
     if(!privacyNotice.trim())fail(503,'관리자가 개인정보 수집 안내를 설정한 후 등록할 수 있습니다.');
     if(p.consent!==true)fail(400,'개인정보 수집 안내를 확인해 주세요.');
     const personal=personalInput(p),pin=pinInput(p.pin),phoneKey=digest(personal.phone);
     if(db.prepare('SELECT id FROM workers WHERE phone_key=?').get(phoneKey))fail(409,'이미 등록된 번호입니다. 로그인해 주세요.');
     const credentialKey=loginKey(personal.birthDate,pin);
     if(db.prepare('SELECT id FROM workers WHERE login_key=?').get(credentialKey))loginConflict();
     const id=randomUUID(),now=new Date().toISOString(),hash=await passwordHash(pin);
     try{db.prepare('INSERT INTO workers(id,phone_key,pin_hash,personal,daily_rate,created_at,consented_at,notice_version,login_key) VALUES(?,?,?,?,NULL,?,?,?,?)').run(id,phoneKey,hash,encrypt(personal,'worker:'+id),now,now,sha(privacyNotice),credentialKey);}catch(e){if(db.prepare('SELECT id FROM workers WHERE login_key=?').get(credentialKey))loginConflict();if(e.code?.includes('SQLITE'))fail(409,'이미 등록되었거나 등록 요청을 완료할 수 없습니다.');throw e;}
     audit('worker.register',id);issue(res,'worker',id);return json(res,201,{worker:workerView(db.prepare('SELECT * FROM workers WHERE id=?').get(id))});
    }
    if(path==='/api/login'&&method==='POST'){
     limit(req,'worker-login',12);const p=await body(req),birthDate=birthInput(p.birthDate),pin=pinInput(p.pin);
     const w=db.prepare('SELECT * FROM workers WHERE login_key=?').get(loginKey(birthDate,pin));
     if(!await passwordMatches(pin,w?.pin_hash||adminHash)||!w)fail(401,'생년월일 또는 비밀번호가 맞지 않습니다.');
     issue(res,'worker',w.id);return json(res,200,{worker:workerView(w)});
    }
    if(path==='/api/me/login'&&method==='PUT'){
     const s=session(req,'worker'),p=await body(req),birthDate=birthInput(p.birthDate),pin=pinInput(p.pin),w=db.prepare('SELECT * FROM workers WHERE id=?').get(s.worker_id);
     if(w.login_key)fail(409,'이미 새 로그인 방식이 설정된 계정입니다.');
     const credentialKey=loginKey(birthDate,pin),personal=decrypt(w.personal,'worker:'+w.id);
     if(personal.rrn&&personal.rrn.slice(0,6)!==birthDate)fail(400,'생년월일과 주민등록번호 앞 6자리가 다릅니다.');
     if(db.prepare('SELECT id FROM workers WHERE login_key=?').get(credentialKey))loginConflict();
     const hash=await passwordHash(pin);personal.birthDate=birthDate;
     try{db.prepare('UPDATE workers SET login_key=?,pin_hash=?,personal=? WHERE id=? AND login_key IS NULL').run(credentialKey,hash,encrypt(personal,'worker:'+w.id),w.id);}catch(e){if(db.prepare('SELECT id FROM workers WHERE login_key=?').get(credentialKey))loginConflict();throw e;}
     audit('worker.migrate-login',w.id);return json(res,200,{worker:workerView(db.prepare('SELECT * FROM workers WHERE id=?').get(w.id))});
    }
    if(path==='/api/admin/login'&&method==='POST'){
     limit(req,'admin-login',5);const p=await body(req),password=text(p.password,1,128,'비밀번호');
     if(!await passwordMatches(password,adminHash))fail(401,'관리자 비밀번호가 맞지 않습니다.');
     audit('admin.login');issue(res,'admin');return json(res,200,{ok:true});
    }
    if(path==='/api/logout'&&method==='POST'){
     const p=await body(req),role=p.role==='admin'?'admin':'worker',s=session(req,role,false);
     if(s)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(s.token_hash);
     res.setHeader('Set-Cookie',cookie(role,'',0));return json(res,200,{ok:true});
    }
    if(path==='/api/me/rate'&&method==='PUT'){
     const s=session(req,'worker'),p=await body(req),rate=integer(p.dailyRate,1,10000000,'일당');
     db.exec('BEGIN IMMEDIATE');try{
      db.prepare('UPDATE workers SET daily_rate=? WHERE id=?').run(rate,s.worker_id);
      db.prepare('UPDATE records SET rate=? WHERE worker_id=? AND rate IS NULL AND units>0').run(rate,s.worker_id);db.exec('COMMIT');
     }catch(e){db.exec('ROLLBACK');throw e;}
     return json(res,200,{dailyRate:rate});
    }
    if(path==='/api/me/records'&&method==='GET'){
     const s=session(req,'worker'),month=checkedMonth(url.searchParams.get('month'));return json(res,200,{records:recordsFor(s.worker_id,month)});
    }
    if(/^\/api\/me\/records\/[^/]+$/.test(path)&&['PUT','DELETE'].includes(method)){
     const s=session(req,'worker'),date=checkedDate(path.split('/').at(-1));
     if(method==='DELETE'){db.prepare('DELETE FROM records WHERE worker_id=? AND date=?').run(s.worker_id,date);return json(res,200,{ok:true});}
     const p=await body(req);if(typeof p.units!=='number'||!Number.isFinite(p.units)||p.units<0||p.units>100||Math.abs(p.units*100-Math.round(p.units*100))>1e-8)fail(400,'공수는 0~100 사이의 숫자로 소수점 둘째 자리까지 입력해 주세요.');
     const units=Math.round(p.units*100),details=units===0?{site:'',work:''}:{site:text(p.site,1,50,'현장'),work:text(p.work,1,200,'작업내용')};
     const prior=db.prepare('SELECT rate FROM records WHERE worker_id=? AND date=?').get(s.worker_id,date),w=db.prepare('SELECT daily_rate FROM workers WHERE id=?').get(s.worker_id);
     const rate=units===0?null:(prior?.rate??w.daily_rate);
     db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(worker_id,date) DO UPDATE SET units=excluded.units,rate=excluded.rate,details=excluded.details,updated_at=excluded.updated_at').run(s.worker_id,date,units,rate,encrypt(details,'record:'+s.worker_id+':'+date),new Date().toISOString());
     const record=db.prepare('SELECT * FROM records WHERE worker_id=? AND date=?').get(s.worker_id,date);return json(res,200,{record:recordView(record)});
    }
    if(path==='/api/admin/workers'&&method==='GET'){
     session(req,'admin');const month=checkedMonth(url.searchParams.get('month'));
     const workers=db.prepare('SELECT * FROM workers ORDER BY created_at DESC LIMIT 1000').all().map(w=>{const records=recordsFor(w.id,month);return {...workerView(w,true),units:records.reduce((s,r)=>s+Math.round(r.units*100),0)/100,amount:records.reduce((s,r)=>s+(r.amount??0),0),unpriced:records.filter(r=>r.units>0&&r.amount===null).length};});
     return json(res,200,{workers});
    }
    const workerMatch=path.match(/^\/api\/admin\/workers\/([a-f0-9-]+)(\/sensitive)?$/);
    if(workerMatch&&method==='GET'){
     session(req,'admin');const w=db.prepare('SELECT * FROM workers WHERE id=?').get(workerMatch[1]);if(!w)fail(404,'작업자를 찾을 수 없습니다.');
     if(workerMatch[2]){audit('admin.reveal-personal',w.id);const p=decrypt(w.personal,'worker:'+w.id);return json(res,200,{rrn:p.rrn||'미등록',account:p.account,bank:p.bank});}
     const month=checkedMonth(url.searchParams.get('month'));audit('admin.view-worker',w.id);return json(res,200,{worker:workerView(w,true),records:recordsFor(w.id,month)});
    }
    fail(404,'요청한 기능을 찾을 수 없습니다.');
   }
   if(method!=='GET'&&method!=='HEAD')fail(405,'지원하지 않는 요청입니다.');
   const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/offline.html':'offline.html','/privacy':'privacy.html'};
   const relative=files[path]||(/^\/icons\/(logo|icon-192|icon-512|icon-180|icon-maskable-512|favicon-32)\.png$/.test(path)?path.slice(1):null);
   if(!relative||!existsSync(resolve(publicDir,relative)))fail(404,'페이지를 찾을 수 없습니다.');
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
   res.writeHead(200,{'Content-Type':types[extname(relative)]||'application/octet-stream','Cache-Control':relative.endsWith('.png')?'public, max-age=3600':'no-cache',...(relative==='sw.js'?{'Service-Worker-Allowed':'/'}:{})});
   res.end(method==='HEAD'?undefined:readFileSync(resolve(publicDir,relative)));
  }catch(e){if(!res.headersSent)json(res,e instanceof HttpError?e.status:500,{error:e instanceof HttpError?e.message:'처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'});else res.end();}
 };
 const server=http.createServer(handler);server.requestTimeout=15000;server.headersTimeout=10000;
 return {server,db,close:()=>new Promise((ok,bad)=>{server.close(e=>{db.close();e?bad(e):ok();});server.closeIdleConnections();})};
}
