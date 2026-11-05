import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.mjs';

const baseConfig={production:false,encryptionKey:'a'.repeat(64),adminPassword:'TestAdminOnly-456!',privacyNotice:'테스트 전용 수집 안내. 실제 개인정보가 아닙니다.',dbPath:':memory:'};
async function fixture(overrides={}){
 const app=await createApp({...baseConfig,...overrides});
 await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+app.server.address().port;
 async function request(path,{method='GET',data,cookie='',headers={}}={}){
  const res=await fetch(origin+path,{method,headers:{...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'TOTAL-ENG'}),...(cookie?{Cookie:cookie}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  const type=res.headers.get('content-type')||'';
  return {status:res.status,body:type.includes('json')?await res.json():await res.text(),cookie:res.headers.get('set-cookie')?.split(';')[0],headers:res.headers};
 }
 const register=(n=1,extra={})=>request('/api/register',{method:'POST',data:{name:'테스트작업자'+n,phone:'0100000000'+n,bank:'테스트은행',account:'000000000000'+n,birthDate:'90010'+n,pin:'1234',consent:true,...extra}});
 const admin=()=>request('/api/admin/login',{method:'POST',data:{password:baseConfig.adminPassword}});
 return {...app,request,register,admin};
}

test('registration requires valid birthday, four-digit password, notice and consent without a company code',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/api/session')).body.worker,null);
  assert.equal((await f.register(1,{birthDate:'901332'})).status,400);
  assert.equal((await f.register(1,{consent:false})).status,400);
  assert.equal((await f.register(1,{pin:'123'})).status,400);
  const r=await f.register();assert.equal(r.status,201);assert.match(r.body.worker.account,/•/);assert.equal(r.body.worker.rrn,'미등록');assert.equal(r.body.worker.dailyRate,null);
  assert.equal((await f.register()).status,409);
  assert.equal((await f.request('/api/admin/workers?month=2026-11',{cookie:r.cookie})).status,401);
  assert.equal((await f.request('/api/admin/login',{method:'POST',data:{password:'1234'}})).status,401);
 }finally{await f.close();}
 const blocked=await fixture({privacyNotice:''});try{assert.equal((await blocked.register()).status,503);}finally{await blocked.close();}
});

test('fractional work, rate setup, unchanged historical rates and cross-device access',async()=>{
 const f=await fixture();try{
  const registration=await f.register(),cookie=registration.cookie;
  const save=(date,units)=>f.request('/api/me/records/'+date,{method:'PUT',cookie,data:{units,site:'테스트현장',work:'배관설치 테스트'}});
  let r=await save('2026-11-05',.25);assert.equal(r.status,200);assert.equal(r.body.record.amount,null);
  assert.equal((await f.request('/api/me/rate',{method:'PUT',cookie,data:{dailyRate:180000}})).status,200);
  let list=(await f.request('/api/me/records?month=2026-11',{cookie})).body.records;assert.equal(list[0].amount,45000);
  r=await save('2026-11-06',1.25);assert.equal(r.body.record.amount,225000);
  r=await save('2026-11-07',.37);assert.equal(r.body.record.amount,66600);
  await f.request('/api/me/rate',{method:'PUT',cookie,data:{dailyRate:200000}});
  r=await save('2026-11-06',1.5);assert.equal(r.body.record.dailyRate,180000);assert.equal(r.body.record.amount,270000);
  r=await save('2026-11-08',1);assert.equal(r.body.record.amount,200000);
  r=await save('2026-11-09',0);assert.equal(r.body.record.amount,0);assert.equal(r.body.record.site,'');
  const second=await f.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'1234'}});assert.equal(second.status,200);
  list=(await f.request('/api/me/records?month=2026-11',{cookie:second.cookie})).body.records;assert.equal(list.length,5);assert.equal(list.find(x=>x.date==='2026-11-06').amount,270000);
  assert.equal((await f.request('/api/me/records/2026-11-07',{method:'DELETE',cookie:second.cookie,data:{}})).status,200);
  assert.equal((await f.request('/api/me/records?month=2026-11',{cookie})).body.records.length,4);
 }finally{await f.close();}
});

test('workers cannot read one another; administrator gets identical calendar and list records',async()=>{
 const f=await fixture();try{
  const a=await f.register(1),b=await f.register(2);
  await f.request('/api/me/rate',{method:'PUT',cookie:a.cookie,data:{dailyRate:180000}});
  await f.request('/api/me/records/2026-11-04',{method:'PUT',cookie:a.cookie,data:{units:.25,site:'테스트 포천',work:'테스트 배관'}});
  assert.deepEqual((await f.request('/api/me/records?month=2026-11',{cookie:b.cookie})).body.records,[]);
  assert.equal((await f.request('/api/admin/workers/'+a.body.worker.id+'?month=2026-11',{cookie:b.cookie})).status,401);
  const admin=await f.admin();assert.equal(admin.status,200);
  const roster=await f.request('/api/admin/workers?month=2026-11',{cookie:admin.cookie});assert.equal(roster.body.workers.length,2);
  assert.equal(roster.body.workers.find(w=>w.id===a.body.worker.id).amount,45000);
  const detail=await f.request('/api/admin/workers/'+a.body.worker.id+'?month=2026-11',{cookie:admin.cookie});assert.equal(detail.body.records[0].units,.25);assert.equal(detail.body.records[0].work,'테스트 배관');
  const sensitive=await f.request('/api/admin/workers/'+a.body.worker.id+'/sensitive',{cookie:admin.cookie});assert.equal(sensitive.body.account,'0000000000001');assert.equal(sensitive.headers.get('cache-control'),'no-store');
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit WHERE action='admin.reveal-personal'").get().n,1);
  await f.request('/api/logout',{method:'POST',cookie:admin.cookie,data:{role:'admin'}});
  assert.equal((await f.request('/api/admin/workers?month=2026-11',{cookie:admin.cookie})).status,401);
  assert.equal((await f.request('/api/me/records?month=2026-11',{cookie:a.cookie})).status,200);
 }finally{await f.close();}
});

test('invalid dates, amounts, fractions, malicious cookies, CSRF and forged identities are rejected',async()=>{
 const f=await fixture();try{
  const a=await f.register(),cookie=a.cookie;
  for(const units of [-1,.001,101,'1',null])assert.equal((await f.request('/api/me/records/2026-11-05',{method:'PUT',cookie,data:{units,site:'현장',work:'작업'}})).status,400);
  for(const date of ['2026-02-30','2026-99-01','2026-11-31','bad'])assert.equal((await f.request('/api/me/records/'+date,{method:'PUT',cookie,data:{units:1,site:'현장',work:'작업'}})).status,400);
  for(const rate of [-1,0,1.25,'180000',10000001])assert.equal((await f.request('/api/me/rate',{method:'PUT',cookie,data:{dailyRate:rate}})).status,400);
  assert.equal((await f.request('/api/me/rate',{method:'PUT',cookie,data:{dailyRate:180000},headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await f.request('/api/me/rate',{method:'PUT',cookie,data:{dailyRate:180000},headers:{'X-Requested-With':''}})).status,403);
  assert.equal((await f.request('/api/admin/workers?month=2026-11',{cookie:'te-admin='+randomBytes(32).toString('hex'),headers:{'oai-authenticated-user-id':'admin'}})).status,401);
  assert.equal((await f.request('/api/me/records?month=2026-13',{cookie})).status,400);
  assert.equal((await f.request('/api/me/records?month=2026-11',{cookie:'te-worker=broken'})).status,401);
 }finally{await f.close();}
});

test('administrator guessing is rate limited; sessions expire and cannot be revived',async()=>{
 const f=await fixture();try{
  for(let i=0;i<5;i++)assert.equal((await f.request('/api/admin/login',{method:'POST',data:{password:'wrong'}})).status,401);
  assert.equal((await f.admin()).status,429);
 }finally{await f.close();}
 const g=await fixture();try{
  const admin=await g.admin();g.db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal((await g.request('/api/admin/workers?month=2026-11',{cookie:admin.cookie})).status,401);
 }finally{await g.close();}
});

test('sensitive fields and work text are encrypted; enabled resident number is only revealed to admin',async()=>{
 const f=await fixture({rrnEnabled:true,rrnBasis:'테스트 전용 가상 근거'});try{
  const registration=await f.register(1,{rrn:'9001010000000'});assert.equal(registration.status,201);assert.equal(registration.body.worker.rrn,'900101-•••••••');
  await f.request('/api/me/records/2026-11-01',{method:'PUT',cookie:registration.cookie,data:{units:1,site:'비공개테스트현장',work:'비공개테스트작업'}});
  const worker=f.db.prepare('SELECT * FROM workers').get(),record=f.db.prepare('SELECT * FROM records').get();
  for(const raw of ['테스트작업자1','01000000001','0000000000001','9001010000000'])assert(!JSON.stringify(worker).includes(raw));
  for(const raw of ['비공개테스트현장','비공개테스트작업'])assert(!JSON.stringify(record).includes(raw));
  assert.match(worker.pin_hash,/^[a-f0-9]{32}:[a-f0-9]{64}$/);assert(!worker.login_key.includes('900101'));
  assert.equal((await f.request('/api/admin/workers/'+worker.id+'/sensitive',{cookie:registration.cookie})).status,401);
  const admin=await f.admin();assert.equal((await f.request('/api/admin/workers/'+worker.id+'/sensitive',{cookie:admin.cookie})).body.rrn,'9001010000000');
 }finally{await f.close();}
 await assert.rejects(()=>createApp({...baseConfig,rrnEnabled:true,rrnBasis:''}),/RRN_COLLECTION_BASIS/);
});

test('database survives restart, backup is consistent and wrong encryption key is refused',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'te-attendance-test-')),path=join(dir,'db.sqlite'),copy=join(dir,'backup.sqlite');
 try{
  const f=await fixture({dbPath:path});const registration=await f.register();await f.request('/api/me/rate',{method:'PUT',cookie:registration.cookie,data:{dailyRate:180000}});
  await backup(f.db,copy);const backedUp=new DatabaseSync(copy,{readOnly:true});assert.equal(backedUp.prepare('SELECT count(*) n FROM workers').get().n,1);backedUp.close();await f.close();
  const g=await fixture({dbPath:path});try{const s=await g.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'1234'}});assert.equal(s.body.worker.dailyRate,180000);}finally{await g.close();}
  await assert.rejects(()=>createApp({...baseConfig,dbPath:path,encryptionKey:'b'.repeat(64)}),/does not match/);
  assert(!readFileSync(path).includes(Buffer.from('테스트작업자1')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('HTTPS settings enforce strong secrets and issue secure HttpOnly cookies',async()=>{
 await assert.rejects(()=>createApp({...baseConfig,adminPassword:'1234'}),/ADMIN_PASSWORD/);
 await assert.rejects(()=>createApp({...baseConfig,production:true,origin:'http://insecure.example'}),/HTTPS/);
 const f=await fixture({production:true,origin:'https://attendance.example.com'});try{
  const a=await f.request('/api/admin/login',{method:'POST',headers:{Origin:'https://attendance.example.com'},data:{password:baseConfig.adminPassword}});
  assert.equal(a.status,200);assert.match(a.headers.get('set-cookie'),/__Host-te-admin=/);assert.match(a.headers.get('set-cookie'),/HttpOnly/);assert.match(a.headers.get('set-cookie'),/SameSite=Strict/);assert.match(a.headers.get('set-cookie'),/Secure/);
 }finally{await f.close();}
});

test('PWA shell, manifest, icons and offline page are served without personal caching',async()=>{
 const f=await fixture();try{
  const home=await f.request('/');assert.equal(home.status,200);assert.match(home.body,/viewport-fit=cover/);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const manifest=await f.request('/manifest.webmanifest');assert.equal(manifest.body.display,'standalone');assert.equal(manifest.body.icons.length,3);
  for(const icon of manifest.body.icons){const file=readFileSync(new URL('../public'+icon.src,import.meta.url));assert.equal(file.readUInt32BE(16),Number(icon.sizes.split('x')[0]));}
  const sw=await f.request('/sw.js');assert.match(sw.body,/url.pathname.startsWith\('\/api\/'\)/);assert.equal(sw.headers.get('cache-control'),'no-cache');assert.match(sw.body,/offline.html/);
  assert.equal((await f.request('/offline.html')).status,200);assert.equal((await f.request('/.env')).status,404);assert.equal((await f.request('/server/app.mjs')).status,404);
 }finally{await f.close();}
});

test('same birthday supports distinct passwords; identical pairs are rejected including concurrent signup',async()=>{
 const f=await fixture();try{
  const a=await f.register(1,{birthDate:'900101',pin:'0007'});assert.equal(a.status,201);
  const b=await f.register(2,{birthDate:'900101',pin:'0070'});assert.equal(b.status,201);
  const duplicate=await f.register(3,{birthDate:'900101',pin:'0007'});assert.equal(duplicate.status,409);assert.match(duplicate.body.error,/다른 4자리/);
  const first=await f.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'0007'}});
  const second=await f.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'0070'}});
  assert.equal(first.body.worker.id,a.body.worker.id);assert.equal(second.body.worker.id,b.body.worker.id);
  assert.equal((await f.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'7777'}})).status,401);
  assert.equal((await f.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'000007'}})).status,400);
  assert.equal((await f.register(3,{birthDate:'900230',pin:'0303'})).status,400);
  assert.equal((await f.register(3,{birthDate:'000229',pin:'0303'})).status,201);
  const raced=await Promise.all([f.register(4,{birthDate:'850101',pin:'0011'}),f.register(5,{birthDate:'850101',pin:'0011'})]);
  assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);
 }finally{await f.close();}
});

test('legacy database migration preserves work, requires an authenticated account and sets new login once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'te-legacy-test-')),path=join(dir,'legacy.sqlite');
 try{
  const f=await fixture({dbPath:path});const a=await f.register();
  await f.request('/api/me/rate',{method:'PUT',cookie:a.cookie,data:{dailyRate:180000}});
  await f.request('/api/me/records/2026-11-05',{method:'PUT',cookie:a.cookie,data:{units:.25,site:'이전현장',work:'기존기록'}});
  await f.close();
  const old=new DatabaseSync(path);old.exec('DROP INDEX workers_login_key; ALTER TABLE workers DROP COLUMN login_key; PRAGMA user_version=1;');old.close();
  const g=await fixture({dbPath:path});try{
   assert.equal((await g.request('/api/session',{cookie:a.cookie})).body.worker.needsLoginSetup,true);
   assert.equal((await g.request('/api/me/login',{method:'PUT',data:{birthDate:'850101',pin:'0027'}})).status,401);
   assert.equal((await g.request('/api/login',{method:'POST',data:{birthDate:'900101',pin:'1234'}})).status,401);
   const migrated=await g.request('/api/me/login',{method:'PUT',cookie:a.cookie,data:{birthDate:'850101',pin:'0027'}});assert.equal(migrated.status,200);assert.equal(migrated.body.worker.needsLoginSetup,false);
   assert.equal((await g.request('/api/me/login',{method:'PUT',cookie:a.cookie,data:{birthDate:'850101',pin:'3333'}})).status,409);
   const login=await g.request('/api/login',{method:'POST',data:{birthDate:'850101',pin:'0027'}});assert.equal(login.body.worker.id,a.body.worker.id);
   const records=(await g.request('/api/me/records?month=2026-11',{cookie:login.cookie})).body.records;assert.equal(records[0].amount,45000);assert.equal(records[0].work,'기존기록');
   assert.equal(g.db.prepare('PRAGMA user_version').get().user_version,2);
  }finally{await g.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('eight-digit admin password is accepted only by server authentication',async()=>{
 const f=await fixture({adminPassword:'87654321'});try{
  assert.equal((await f.request('/api/admin/login',{method:'POST',data:{password:'87654321'}})).status,200);
  assert.equal((await f.request('/api/admin/login',{method:'POST',data:{password:'87654320'}})).status,401);
 }finally{await f.close();}
});
