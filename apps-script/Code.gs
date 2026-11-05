/** TOTAL ENG attendance — private Google Sheets backend, v2.0.0.
 * Paste into the bound Apps Script project. Keep the spreadsheet restricted.
 * Run setupApp from the editor, then use its private setup dialog.
 */
var TE_SHEET_ID = '105FFYZ-lYkTOBqyBr4X9clGqWCkjzVlh3gYBaKE_Bo8';
var TE_TABLES = {
  '작업자': ['ID','이름','생년월일','전화번호','은행','계좌끝4자리','주민번호등록','민감정보암호문','전화검색키','로그인검색키','비밀번호검증','일당','등록일시','동의일시','안내문버전'],
  '근태기록': ['작업자ID','날짜','공수','적용일당','현장','작업내용','수정일시'],
  '로그인세션': ['토큰해시','역할','작업자ID','만료시각'],
  '로그인제한': ['검색키','시도수','만료시각'],
  '접근기록': ['구분','대상ID','일시']
};

function setupApp() {
  teOwner_();
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    var book=SpreadsheetApp.openById(TE_SHEET_ID);
    Object.keys(TE_TABLES).forEach(function(name){
      var sheet=book.getSheetByName(name)||book.insertSheet(name),headers=TE_TABLES[name];
      if(sheet.getLastRow()>0){
        var prior=sheet.getRange(1,1,1,headers.length).getDisplayValues()[0];
        if(JSON.stringify(prior)!==JSON.stringify(headers))throw new Error(name+' 탭의 기존 머리글이 다릅니다. 기존 데이터를 확인해 주세요.');
      }else{
        sheet.getRange(1,1,1,headers.length).setValues([headers]);
      }
      sheet.setFrozenRows(1);sheet.getRange(1,1,1,headers.length).setBackground('#003d8e').setFontColor('#ffffff').setFontWeight('bold');
      sheet.autoResizeColumns(1,headers.length);
    });
    var props=PropertiesService.getScriptProperties();
    if(!props.getProperty('SERVER_SECRET'))props.setProperty('SERVER_SECRET',Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid());
    props.setProperty('SHEET_ID',TE_SHEET_ID);
    props.setProperty('OWNER_EMAIL',Session.getActiveUser().getEmail());
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('Setup').setWidth(520).setHeight(650),'TOTAL ENG 비공개 초기 설정');
  } finally { lock.releaseLock(); }
}

function teOwner_(){
  var active=Session.getActiveUser().getEmail(),effective=Session.getEffectiveUser().getEmail();
  if(!active||active!==effective)throw new Error('시트 소유자 계정의 Apps Script 편집기에서 실행해 주세요.');
  var owner=PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  if(owner&&owner!==active)throw new Error('초기 설정 소유자 계정에서만 변경할 수 있습니다.');
}

function saveInitialSetup(input){
  teOwner_();var lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    var props=PropertiesService.getScriptProperties();
    if(props.getProperty('CONFIGURED')==='true')throw new Error('이미 설정되었습니다. 기존 암호화 키를 덮어쓰지 않습니다.');
    teText_(input.password,8,128,'관리자 비밀번호');teText_(input.notice,10,2000,'개인정보 안내');
    if(!input.publicKey||!input.wrappedPrivateKey)throw new Error('암호화 키 생성이 완료되지 않았습니다.');
    var bundle=input.wrappedPrivateKey;
    if(bundle.iterations!==600000||!/^[A-Za-z0-9+/=]+$/.test(input.publicKey)||input.publicKey.length>1000||typeof bundle.data!=='string'||bundle.data.length>8000||typeof bundle.salt!=='string'||typeof bundle.iv!=='string')throw new Error('암호화 설정을 확인해 주세요.');
    props.setProperties({
      ADMIN_CHECK:tePasswordCheck_('admin',input.password),
      PRIVACY_NOTICE:input.notice.trim(),PUBLIC_KEY:input.publicKey,
      WRAPPED_PRIVATE_KEY:JSON.stringify(bundle),COLLECT_RRN:input.collectRrn?'true':'false',
      RRN_COLLECTION_BASIS:input.collectRrn?teText_(input.rrnBasis,5,1000,'수집 근거'):'',CONFIGURED:'true'
    });
    teAudit_('owner.setup','');return {ok:true};
  } finally {lock.releaseLock();}
}

function doGet(){return teOutput_({ok:true,app:'TOTAL ENG 근태 관리',version:'2.0.0',configured:PropertiesService.getScriptProperties().getProperty('CONFIGURED')==='true'});}
function doPost(e){
  var lock=LockService.getScriptLock();
  try {
    if(!e||!e.postData||e.postData.contents.length>24000)teFail_(400,'요청 크기를 확인해 주세요.');
    var request;try{request=JSON.parse(e.postData.contents);}catch(ignore){teFail_(400,'입력 형식을 확인해 주세요.');}
    if(!lock.tryLock(20000))teFail_(503,'다른 요청을 처리 중입니다. 잠시 후 다시 눌러 주세요.');
    return teOutput_({ok:true,data:teRoute_(request)});
  } catch(error){return teOutput_({ok:false,status:error.teStatus||500,error:error.teStatus?error.message:'처리하지 못했습니다. Apps Script 설정과 실행 기록을 확인해 주세요.'});}
  finally {if(lock.hasLock())lock.releaseLock();}
}
function teOutput_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function teFail_(status,message){var error=new Error(message);error.teStatus=status;throw error;}
function teText_(value,min,max,label){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)teFail_(400,label+'을(를) 확인해 주세요.');return value.trim();}
function teBirth_(value){
  if(typeof value!=='string'||!/^\d{6}$/.test(value))teFail_(400,'생년월일은 숫자 6자리로 입력해 주세요.');
  var y=2000+Number(value.slice(0,2)),m=Number(value.slice(2,4)),d=Number(value.slice(4)),date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)teFail_(400,'생년월일을 확인해 주세요.');return value;
}
function tePin_(pin){if(typeof pin!=='string'||!/^\d{4}$/.test(pin))teFail_(400,'비밀번호는 숫자 4자리로 입력해 주세요.');return pin;}
function teMonth_(value){if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'2000-01'||value>'2100-12')teFail_(400,'조회할 월을 확인해 주세요.');return value;}
function teDate_(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'2100-12-31')teFail_(400,'날짜를 확인해 주세요.');var date=new Date(value+'T12:00:00Z');if(isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)teFail_(400,'날짜를 확인해 주세요.');return value;}
function teHex_(bytes){return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function teSha_(value){return teHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8));}
function teMac_(scope,value){return teHex_(Utilities.computeHmacSha256Signature(scope+'|'+value,PropertiesService.getScriptProperties().getProperty('SERVER_SECRET'),Utilities.Charset.UTF_8));}
function teEqual_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function tePasswordCheck_(id,pin){return teMac_('password',id+'|'+pin);}
function teSheet_(name){var sheet=SpreadsheetApp.openById(TE_SHEET_ID).getSheetByName(name);if(!sheet)teFail_(503,'먼저 setupApp을 실행해 주세요.');return sheet;}
function teRows_(name){var sheet=teSheet_(name);return sheet.getLastRow()<2?[]:sheet.getRange(2,1,sheet.getLastRow()-1,TE_TABLES[name].length).getDisplayValues().map(function(values,i){return {row:i+2,v:values};});}
function teWrite_(name,row,values){var sheet=teSheet_(name),safe=values.map(function(v){var s=v===null||v===undefined?'':String(v);return /^[=+@-]/.test(s)?"'"+s:s;});sheet.getRange(row,1,1,safe.length).setNumberFormat('@').setValues([safe]);}
function teAppend_(name,values){teWrite_(name,teSheet_(name).getLastRow()+1,values);}
function teAudit_(action,id){teAppend_('접근기록',[action,id,new Date().toISOString()]);}
function teLimit_(scope,max,windowMs){
  var key=teMac_('limit',scope),now=Date.now(),rows=teRows_('로그인제한');
  for(var i=rows.length-1;i>=0;i--)if(Number(rows[i].v[2])<=now)teSheet_('로그인제한').deleteRow(rows[i].row);
  var prior=teRows_('로그인제한').filter(function(r){return r.v[0]===key;})[0];
  if(prior&&Number(prior.v[1])>=max)teFail_(429,'시도가 많습니다. 잠시 후 다시 해주세요.');
  if(prior)teWrite_('로그인제한',prior.row,[key,Number(prior.v[1])+1,prior.v[2]]);else teAppend_('로그인제한',[key,1,now+(windowMs||900000)]);
}
function teSession_(token,role,required){
  var hashed=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?teSha_(token):'',now=Date.now();
  var s=hashed?teRows_('로그인세션').filter(function(r){return r.v[0]===hashed&&r.v[1]===role&&Number(r.v[3])>now;})[0]:null;
  if(!s&&required)teFail_(401,role==='admin'?'관리자 인증이 필요합니다.':'다시 로그인해 주세요.');return s||null;
}
function teIssue_(role,id){
  var rows=teRows_('로그인세션'),now=Date.now();for(var i=rows.length-1;i>=0;i--)if(Number(rows[i].v[3])<=now)teSheet_('로그인세션').deleteRow(rows[i].row);
  var token=teMac_('session',Utilities.getUuid()+'|'+now+'|'+Utilities.getUuid());teAppend_('로그인세션',[teSha_(token),role,id||'',now+(role==='admin'?1200000:2592000000)]);return token;
}
function teWorker_(id){var w=teRows_('작업자').filter(function(r){return r.v[0]===id;})[0];if(!w)teFail_(404,'작업자를 찾을 수 없습니다.');return w;}
function teWorkerView_(w){var p=w.v;return {id:p[0],name:p[1],birthDate:p[2],phone:p[3],bank:p[4],account:'•••• '+p[5],rrn:p[6]==='true'?p[2]+'-•••••••':'미등록',dailyRate:p[11]===''?null:Number(p[11]),createdAt:p[12],needsLoginSetup:false};}
function teRecordView_(r){var p=r.v,units=Number(p[2]),rate=p[3]===''?null:Number(p[3]);return {date:p[1],units:units,dailyRate:rate,amount:units===0?0:rate===null?null:Math.round(units*rate),site:p[4],work:p[5],updatedAt:p[6]};}
function teRecords_(id,month){return teRows_('근태기록').filter(function(r){return r.v[0]===id&&r.v[1].slice(0,7)===month;}).map(teRecordView_).sort(function(a,b){return a.date.localeCompare(b.date);});}
function teEnvelope_(value){
  if(!value||value.version!==1||!['iv','wrappedKey','data'].every(function(k){return typeof value[k]==='string'&&/^[A-Za-z0-9+/=]+$/.test(value[k]);})||value.iv.length!==16||value.wrappedKey.length>1000||value.data.length>3000)teFail_(400,'계좌정보 암호화를 확인해 주세요.');return JSON.stringify(value);
}

function teRoute_(r){
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('CONFIGURED')!=='true')teFail_(503,'시트 소유자가 먼저 초기 설정을 완료해야 합니다.');
  if(typeof r.path!=='string'||r.path.length>250)teFail_(400,'요청 경로를 확인해 주세요.');
  var u=r.path.split('?'),path=u[0],query={};(u[1]||'').split('&').forEach(function(part){var x=part.split('=');if(x[0])query[decodeURIComponent(x[0])]=decodeURIComponent(x[1]||'');});
  var method=r.method||'GET',p=r.payload||{},w,s,rows,now=new Date().toISOString();
  if(path==='/config'&&method==='GET')return {rrnEnabled:props.getProperty('COLLECT_RRN')==='true',rrnBasis:props.getProperty('RRN_COLLECTION_BASIS')||'',privacyNotice:props.getProperty('PRIVACY_NOTICE'),registrationEnabled:true,publicKey:props.getProperty('PUBLIC_KEY'),version:'2.0.0'};
  if(path==='/session'&&method==='GET'){
    s=teSession_(r.workerToken,'worker',false);return {worker:s?teWorkerView_(teWorker_(s.v[2])):null,admin:Boolean(teSession_(r.adminToken,'admin',false))};
  }
  if(path==='/register'&&method==='POST'){
    teLimit_('register',30,3600000);
    if(p.consent!==true)teFail_(400,'개인정보 안내를 확인해 주세요.');
    var name=teText_(p.name,2,50,'이름'),birth=teBirth_(p.birthDate),pin=tePin_(p.pin),phone=teText_(p.phone,10,20,'전화번호').replace(/\D/g,''),bank=teText_(p.bank,2,30,'은행');
    if(!/^01[016789]\d{7,8}$/.test(phone))teFail_(400,'전화번호를 확인해 주세요.');
    if(typeof p.accountLast4!=='string'||!/^\d{4}$/.test(p.accountLast4))teFail_(400,'계좌번호를 확인해 주세요.');
    var cipher=teEnvelope_(p.sensitiveCipher),phoneKey=teMac_('phone',phone),loginKey=teMac_('login',birth+'|'+pin);rows=teRows_('작업자');
    if(rows.some(function(x){return x.v[8]===phoneKey;}))teFail_(409,'이미 등록된 번호입니다. 로그인해 주세요.');
    if(rows.some(function(x){return x.v[9]===loginKey;}))teFail_(409,'같은 생년월일에 사용 중인 비밀번호입니다. 다른 4자리 번호를 정해 주세요.');
    if(props.getProperty('COLLECT_RRN')==='true'&&p.hasRrn!==true)teFail_(400,'주민등록번호를 입력해 주세요.');
    if(props.getProperty('COLLECT_RRN')!=='true'&&p.hasRrn===true)teFail_(400,'현재 주민등록번호 수집은 비활성화되어 있습니다.');
    var id=Utilities.getUuid();teAppend_('작업자',[id,name,birth,phone,bank,p.accountLast4,p.hasRrn===true?'true':'false',cipher,phoneKey,loginKey,tePasswordCheck_(id,pin),'',now,now,teSha_(props.getProperty('PRIVACY_NOTICE'))]);
    teAudit_('worker.register',id);return {worker:teWorkerView_(teWorker_(id)),workerToken:teIssue_('worker',id)};
  }
  if(path==='/login'&&method==='POST'){
    var birthDate=teBirth_(p.birthDate),password=tePin_(p.pin);teLimit_('worker-login|'+birthDate,12);teLimit_('all-worker-logins',100);
    var key=teMac_('login',birthDate+'|'+password);w=teRows_('작업자').filter(function(x){return x.v[9]===key;})[0];
    if(!w||!teEqual_(w.v[10],tePasswordCheck_(w.v[0],password)))teFail_(401,'생년월일 또는 비밀번호가 맞지 않습니다.');
    return {worker:teWorkerView_(w),workerToken:teIssue_('worker',w.v[0])};
  }
  if(path==='/admin/login'&&method==='POST'){
    teLimit_('admin-login',5);teText_(p.password,1,128,'관리자 비밀번호');
    if(!teEqual_(props.getProperty('ADMIN_CHECK'),tePasswordCheck_('admin',p.password)))teFail_(401,'관리자 비밀번호가 맞지 않습니다.');
    teAudit_('admin.login','');return {adminToken:teIssue_('admin',''),wrappedPrivateKey:JSON.parse(props.getProperty('WRAPPED_PRIVATE_KEY'))};
  }
  if(path==='/logout'&&method==='POST'){
    var role=p.role==='admin'?'admin':'worker';s=teSession_(role==='admin'?r.adminToken:r.workerToken,role,false);if(s)teSheet_('로그인세션').deleteRow(s.row);return {ok:true};
  }
  if(path.indexOf('/me/')===0){
    s=teSession_(r.workerToken,'worker',true);w=teWorker_(s.v[2]);
    if(path==='/me/rate'&&method==='PUT'){
      if(!Number.isInteger(p.dailyRate)||p.dailyRate<1||p.dailyRate>10000000)teFail_(400,'일당을 숫자로 확인해 주세요.');
      w.v[11]=String(p.dailyRate);teWrite_('작업자',w.row,w.v);
      teRows_('근태기록').forEach(function(x){if(x.v[0]===w.v[0]&&Number(x.v[2])>0&&x.v[3]===''){x.v[3]=String(p.dailyRate);teWrite_('근태기록',x.row,x.v);}});
      return {dailyRate:p.dailyRate};
    }
    if(path==='/me/records'&&method==='GET')return {records:teRecords_(w.v[0],teMonth_(query.month))};
    if(/^\/me\/records\/[^/]+$/.test(path)&&['PUT','DELETE'].indexOf(method)>=0){
      var date=teDate_(path.split('/').pop()),old=teRows_('근태기록').filter(function(x){return x.v[0]===w.v[0]&&x.v[1]===date;})[0];
      if(method==='DELETE'){if(old)teSheet_('근태기록').deleteRow(old.row);return {ok:true};}
      if(typeof p.units!=='number'||!isFinite(p.units)||p.units<0||p.units>100||Math.abs(p.units*100-Math.round(p.units*100))>1e-8)teFail_(400,'공수는 소수점 둘째 자리까지 입력해 주세요.');
      var units=Math.round(p.units*100),details=units?{site:teText_(p.site,1,50,'현장'),work:teText_(p.work,1,200,'작업내용')}:{site:'',work:''},rate=units===0?'':old&&old.v[3]!==''?old.v[3]:w.v[11];
      var data=[w.v[0],date,units/100,rate,details.site,details.work,now];if(old)teWrite_('근태기록',old.row,data);else teAppend_('근태기록',data);return {record:teRecordView_({v:data})};
    }
  }
  if(path.indexOf('/admin/')===0){
    teSession_(r.adminToken,'admin',true);
    if(path==='/admin/workers'&&method==='GET'){
      var month=teMonth_(query.month);return {workers:teRows_('작업자').map(function(x){var view=teWorkerView_(x),list=teRecords_(x.v[0],month);view.units=list.reduce(function(n,a){return n+Math.round(a.units*100);},0)/100;view.amount=list.reduce(function(n,a){return n+(a.amount||0);},0);view.unpriced=list.filter(function(a){return a.units>0&&a.amount===null;}).length;return view;})};
    }
    var match=path.match(/^\/admin\/workers\/([a-f0-9-]+)(\/sensitive)?$/i);
    if(match&&method==='GET'){
      w=teWorker_(match[1]);
      if(match[2]){teAudit_('admin.reveal-personal',w.v[0]);return {sensitiveCipher:JSON.parse(w.v[7]),wrappedPrivateKey:JSON.parse(props.getProperty('WRAPPED_PRIVATE_KEY'))};}
      teAudit_('admin.view-worker',w.v[0]);return {worker:teWorkerView_(w),records:teRecords_(w.v[0],teMonth_(query.month))};
    }
  }
  teFail_(404,'요청한 기능을 찾을 수 없습니다.');
}
