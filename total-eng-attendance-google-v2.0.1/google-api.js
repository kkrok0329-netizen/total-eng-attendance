(()=>{
'use strict';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const WORKER_TOKEN='te-google-worker-token',ADMIN_TOKEN='te-google-admin-token';
let privateKey=null,privateKeyTimer=null;
function b64(bytes){let text='';for(const n of new Uint8Array(bytes))text+=String.fromCharCode(n);return btoa(text);}
function bytes(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function endpoint(){const url=window.TE_CONFIG?.apiUrl||'';if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw Error('Apps Script 웹 앱을 배포한 뒤 config.js에 /exec 주소를 입력해 주세요.');return url;}
function read(store,key){try{return store.getItem(key)||'';}catch{return '';}}
function save(store,key,value){try{if(value)store.setItem(key,value);else store.removeItem(key);}catch{throw Error('이 브라우저에서 앱 저장 공간을 사용할 수 없습니다. 일반 브라우저에서 열어 주세요.');}}
function forgetAdmin(){privateKey=null;clearTimeout(privateKeyTimer);try{sessionStorage.removeItem(ADMIN_TOKEN);}catch{}}
async function unlock(password,bundle){
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 if(bundle.version!==1||bundle.iterations!==600000)throw Error('관리자 키 설정을 확인해 주세요.');
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(bundle.salt),iterations:bundle.iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(bundle.iv),additionalData:encoder.encode('TOTAL-ENG-ADMIN-KEY-v1')},key,bytes(bundle.data));
 const result=await crypto.subtle.importKey('pkcs8',raw,{name:'RSA-OAEP',hash:'SHA-256'},false,['decrypt']);
 return result;
}
async function encryptSensitive(data,publicKey){
 if(!crypto.subtle)throw Error('암호화를 위해 HTTPS 주소 또는 로컬 테스트 주소로 접속해 주세요.');
 const rsa=await crypto.subtle.importKey('spki',bytes(publicKey),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('TOTAL-ENG-SENSITIVE-v1')},aes,encoder.encode(JSON.stringify(data)));
 const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,await crypto.subtle.exportKey('raw',aes));
 return {version:1,iv:b64(iv),wrappedKey:b64(wrapped),data:b64(encrypted)};
}
async function decryptSensitive(envelope){
 if(!privateKey)throw Error('계좌정보를 보려면 관리자 모드를 종료한 뒤 다시 관리자 인증을 해주세요.');
 const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},privateKey,bytes(envelope.wrappedKey));
 const key=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(envelope.iv),additionalData:encoder.encode('TOTAL-ENG-SENSITIVE-v1')},key,bytes(envelope.data));
 return JSON.parse(decoder.decode(plain));
}
async function request(path,method,payload){
 let response;
 try{response=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({path,method,payload,workerToken:read(localStorage,WORKER_TOKEN),adminToken:read(sessionStorage,ADMIN_TOKEN)}),credentials:'omit',redirect:'follow',cache:'no-store'});}
 catch(error){if(error.message.includes('config.js'))throw error;throw Error('저장 서버에 연결하지 못했습니다. 인터넷과 Apps Script의 모든 사용자 접근 설정을 확인해 주세요.');}
 let result;try{result=await response.json();}catch{throw Error('Apps Script에서 JSON 응답을 받지 못했습니다. 배포 주소와 접근 권한을 확인해 주세요.');}
 if(!response.ok||!result.ok){const status=result.status||response.status;if(status===401){if(path.startsWith('/admin/'))forgetAdmin();else if(path.startsWith('/me/'))save(localStorage,WORKER_TOKEN,'');}const e=new Error(result.error||'요청을 완료하지 못했습니다.');e.status=status;throw e;}
 return result.data;
}
async function call(path,method='GET',payload){
 let body=payload;
 if(path==='/register'){
  const conf=await request('/config','GET'),account=String(payload.account||'').replace(/[\s-]/g,''),rrn=String(payload.rrn||'').replace(/-/g,'');
  if(!/^\d{5,30}$/.test(account))throw Error('계좌번호를 숫자로 입력해 주세요.');
  if(conf.rrnEnabled&&(!/^\d{13}$/.test(rrn)||rrn.slice(0,6)!==payload.birthDate))throw Error('생년월일과 주민등록번호를 확인해 주세요.');
  const sensitive={bank:payload.bank,account,rrn:conf.rrnEnabled?rrn:'미등록'};
  body={...payload,accountLast4:account.slice(-4),hasRrn:conf.rrnEnabled,sensitiveCipher:await encryptSensitive(sensitive,conf.publicKey)};
  delete body.account;delete body.rrn;
 }
 const result=await request(path,method,body);
 if(result.workerToken)save(localStorage,WORKER_TOKEN,result.workerToken);
 if(path==='/admin/login'){
  try{privateKey=await unlock(payload.password,result.wrappedPrivateKey);}catch{forgetAdmin();throw Error('관리자 암호화 키를 열지 못했습니다. 초기 설정 때 지정한 비밀번호를 확인해 주세요.');}
  save(sessionStorage,ADMIN_TOKEN,result.adminToken);clearTimeout(privateKeyTimer);privateKeyTimer=setTimeout(forgetAdmin,1200000);
 }
 if(path==='/session')result.admin=Boolean(result.admin&&privateKey);
 if(path==='/logout'){if(payload.role==='admin')forgetAdmin();else save(localStorage,WORKER_TOKEN,'');}
 if(/\/sensitive$/.test(path))return await decryptSensitive(result.sensitiveCipher);
 return result;
}
window.TEGoogle={call};
})();
