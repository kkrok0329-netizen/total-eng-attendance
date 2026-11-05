(()=>{
'use strict';
const root=document.getElementById('te-attendance'),main=document.getElementById('te-main'),status=document.getElementById('te-status');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Math.round(n).toLocaleString('ko-KR');
const fmt=n=>Number(n).toFixed(2).replace(/0$/,'');
let page='calendar',month=today().slice(0,7),selected=today(),me=null,isAdmin=false,records=[],workers=[],active=null,adminRecords=[],config={},draft=null,busy=false,installPrompt=null,fromWage='calendar',revealTimer=null;
let detailMode=localStorage.getItem('te-detail-mode')==='calendar'?'calendar':'list';
const headings={calendar:['나의 근무 기록','공수달력','날짜를 누르고 일한 만큼 입력하세요.'],entry:['날짜별 근무 기록','공수 입력','큰 버튼을 누르거나 직접 입력하세요.'],wage:['급여 계산의 기준','내 일당 설정','하루 1공수 기준 금액을 입력하세요.'],profile:['작업자 계정','내 정보','등록 정보와 내 일당을 확인하세요.'],settings:['앱 관리','설정','앱 설치와 관리자 메뉴를 확인하세요.'],login:['처음 오셨나요?','작업자 로그인','생년월일 6자리와 비밀번호 4자리를 입력하세요.'],register:['최초 한 번 등록','작업자 등록','생년월일과 비밀번호를 정하면 바로 가입돼요.'],setupLogin:['기존 기록 그대로','로그인 방식 변경','생년월일과 새 비밀번호 4자리를 설정하세요.'],adminLogin:['관리자 전용','관리자 인증','회사 관리자 비밀번호를 입력하세요.'],admin:['관리자 전용','작업자 관리','작업자를 누르면 작업내역이 나와요.'],worker:['관리자 전용','작업자 상세','달력 또는 목록으로 작업을 확인하세요.'],install:['갤럭시 · 아이폰','앱 설치하기','홈 화면에 추가하면 앱처럼 사용할 수 있어요.']};
function notify(message,error=false){status.className=error?'te-notice error':'te-notice';status.textContent=message;status.hidden=!message;}
async function api(path,method='GET',payload){
 let response;try{response=await fetch('/api'+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Requested-With':'TOTAL-ENG'},body:payload===undefined?undefined:JSON.stringify(payload),credentials:'same-origin',cache:'no-store'});}catch{throw new Error('인터넷 연결을 확인해 주세요. 저장은 완료되지 않았습니다.');}
 const data=await response.json();
 if(!response.ok){if(response.status===401&&path.startsWith('/admin/'))isAdmin=false;if(response.status===401&&path.startsWith('/me/'))me=null;throw new Error(data.error||'요청을 완료하지 못했습니다.');}return data;
}
const card=html=>'<section class="te-card">'+html+'</section>';
const button=(label,attrs='',secondary=false)=>'<button type="button" class="te-primary '+(secondary?'te-secondary':'')+'" '+attrs+'>'+label+'</button>';
const row=(label,value)=>'<div class="te-row"><span>'+escape(label)+'</span><strong>'+escape(value)+'</strong></div>';
const field=(label,id,attrs='')=>'<label class="te-field">'+label+'<input id="'+id+'" '+attrs+'></label>';
const back=(label,go)=>'<button type="button" class="te-back" data-go="'+go+'">‹ '+label+'</button>';
function total(list){return {units:list.reduce((s,r)=>s+Math.round(r.units*100),0)/100,amount:list.reduce((s,r)=>s+(r.amount??0),0),unpriced:list.filter(r=>r.units>0&&r.amount===null).length};}
function summary(list){const t=total(list);return '<div class="te-summary"><div><small>월 합계 공수</small><strong>'+fmt(t.units)+'<em>공수</em></strong></div><div><small>예상 금액 · 공제 전</small><strong>'+money(t.amount)+'<em>원</em></strong></div>'+(t.unpriced?'<p class="te-note">일당 미설정 '+t.unpriced+'건은 금액에 포함되지 않았어요.</p>':'')+'</div>';}
function monthPicker(){return '<div class="te-month"><button class="te-arrow" type="button" data-month="-1" aria-label="이전 달">‹</button><strong>'+Number(month.slice(0,4))+'년 '+Number(month.slice(5))+'월</strong><button class="te-arrow" type="button" data-month="1" aria-label="다음 달">›</button></div>';}
function grid(list,readOnly=false){
 const first=new Date(month+'-01T12:00:00').getDay(),last=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate(),map=new Map(list.map(r=>[r.date,r]));let cells='';
 for(let i=0;i<Math.ceil((first+last)/7)*7;i++){
  const day=i-first+1;if(day<1||day>last){cells+='<div class="te-day te-empty" aria-hidden="true"></div>';continue;}
  const date=month+'-'+String(day).padStart(2,'0'),r=map.get(date),color=!r?'':r.units===0?'te-rest':r.units===1?'':r.units===.5?'te-half':r.units>1?'te-overtime':'te-quarter';
  const pay=!r||r.units===0?'':r.amount===null?'미설정':(r.amount/10000).toLocaleString('ko-KR',{maximumFractionDigits:4})+'만';
  cells+='<button type="button" class="te-day '+(date===selected?'te-selected':'')+'" data-'+(readOnly?'inspect':'date')+'="'+date+'" aria-label="'+Number(month.slice(5))+'월 '+day+'일 '+(r?(r.units===0?'휴무':fmt(r.units)+'공수 '+(r.amount===null?'일당 미설정':money(r.amount)+'원')):'기록 없음')+'"><span class="te-date">'+day+'</span>'+(r?'<span class="te-unit '+color+'">'+(r.units===0?'휴무':fmt(r.units))+'</span><span class="te-money">'+pay+'</span>':'')+'</button>';
 }
 return '<div class="te-calendar"><div class="te-week">'+['일','월','화','수','목','금','토'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="te-days">'+cells+'</div></div><div class="te-legend"><span><b class="te-dot"></b>1공수</span><span><b class="te-dot half"></b>0.5</span><span><b class="te-dot quarter"></b>기타 소수</span><span><b class="te-dot over"></b>1공수 초과</span><span><b class="te-dot rest"></b>휴무</span></div>';
}
function calendar(){return (me.dailyRate===null?'<div class="te-wage-banner"><b>먼저 내 일당을 입력해 주세요</b><p>공수는 기록할 수 있고, 일당 입력 후 금액이 계산돼요.</p>'+button('내 일당 입력하기','data-action="wage"')+'</div>':row('내 일당',money(me.dailyRate)+'원')+button('일당 변경','data-action="wage"',true))+button('오늘 공수 입력하기','data-action="today"')+summary(records)+monthPicker()+grid(records)+'<p class="te-note">날짜를 누르면 입력·수정할 수 있어요.<br>달력의 금액은 만원 단위입니다.</p>';}
function openEntry(date){selected=date;const r=records.find(x=>x.date===date);draft={units:r?String(r.units):'1',site:r?.site||'',work:r?.work||'',rate:r?.dailyRate??me.dailyRate};page='entry';render();}
function entry(){return back('달력으로','calendar')+card('<h2>'+Number(selected.slice(5,7))+'월 '+Number(selected.slice(8))+'일</h2><p class="te-note">1. 일한 만큼 눌러 주세요</p><div class="te-choice-grid">'+[['1','하루'],['0.5','반나절'],['0.25','반의 반'],['0.75','4분의 3'],['1.5','하루 반'],['0','휴무']].map(([n,t])=>'<button type="button" class="te-choice" data-unit="'+n+'" aria-pressed="'+(Number(draft.units)===Number(n))+'">'+t+'<small>'+n+'공수</small></button>').join('')+'</div>'+field('다른 공수 직접 입력','entry-units','inputmode="decimal" value="'+escape(draft.units)+'" placeholder="예: 0.25 또는 1.25"')+'<p class="te-note">소수점 둘째 자리까지 입력할 수 있어요.</p><div class="te-calc" id="entry-calc" aria-live="polite"></div><button type="button" class="te-link" data-action="wage">'+(draft.rate===null?'일당 입력하기':'기본 일당 설정')+'</button><div class="te-form">'+field('2. 작업한 현장','entry-site','value="'+escape(draft.site)+'" maxlength="50" placeholder="예: 포천 현장"')+'<label class="te-field">3. 작업내용<textarea id="entry-work" maxlength="200" placeholder="예: 배관 설치 보조">'+escape(draft.work)+'</textarea></label></div>'+button('이 날짜에 저장하기','data-action="save-entry"')+(records.some(r=>r.date===selected)?button('이 날짜 기록 삭제','data-action="delete-entry"',true):''));}
function readDraft(){if(page!=='entry'||!draft)return;draft.units=document.getElementById('entry-units').value;draft.site=document.getElementById('entry-site').value;draft.work=document.getElementById('entry-work').value;}
function updateCalc(){
 const n=Number(draft.units),valid=/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(draft.units.trim())&&n>=0&&n<=100;
 document.getElementById('entry-calc').innerHTML=!valid?'공수를 0~100 사이의 숫자로 입력해 주세요.':n===0?'휴무로 기록합니다.':draft.rate===null?'일당 입력 후 금액이 계산돼요.':'일당 '+money(draft.rate)+'원 × '+fmt(n)+'공수<strong>'+money(draft.rate*n)+'원</strong>';
 root.querySelectorAll('[data-unit]').forEach(b=>b.setAttribute('aria-pressed',String(valid&&Number(b.dataset.unit)===n)));
 document.getElementById('entry-site').disabled=valid&&n===0;document.getElementById('entry-work').disabled=valid&&n===0;
}
function wage(){return back('이전 화면',fromWage)+card('<h2>하루 일당이 얼마인가요?</h2>'+field('1공수 기준 일당 (원)','wage','inputmode="numeric" value="'+(me.dailyRate??'')+'" placeholder="예: 180000"')+'<p class="te-note">18만원이면 180000을 입력하세요.<br>이미 일당이 저장된 날짜의 금액은 바뀌지 않아요.</p>'+button('이 일당으로 저장하기','data-action="save-wage"'));}
function profile(){return card('<h2>'+escape(me.name)+' 님</h2>'+row('생년월일',me.birthDate||'미설정')+row('전화번호',me.phone)+row('주민등록번호',me.rrn)+row('은행',me.bank)+row('급여 계좌',me.account)+row('내 일당',me.dailyRate===null?'미설정':money(me.dailyRate)+'원')+button('내 일당 설정','data-action="wage"'))+button('작업자 로그아웃','data-action="logout"',true);}
function login(){return card('<h2>내 기록에 로그인</h2><div class="te-form">'+field('생년월일 6자리','login-birth','inputmode="numeric" maxlength="6" autocomplete="username" placeholder="예: 900101"')+field('비밀번호 4자리','login-pin','type="password" inputmode="numeric" maxlength="4" autocomplete="current-password"')+'</div>'+button('로그인','data-action="login"')+button('처음 오셨나요? 작업자 등록','data-go="register"',true))+'<p class="te-note">비밀번호를 잊었다면 회사 담당자에게 문의해 주세요.</p>';}
function register(){return card('<h2>기본 정보 입력</h2>'+(config.registrationEnabled?'':'<p class="te-note">회사 담당자가 개인정보 안내를 설정한 후 등록할 수 있어요.</p>')+'<div class="te-form">'+field('이름','reg-name','autocomplete="name" maxlength="50"')+field('생년월일 6자리','reg-birth','inputmode="numeric" maxlength="6" placeholder="예: 900101" autocomplete="off"')+field('전화번호','reg-phone','type="tel" autocomplete="tel"')+(config.rrnEnabled?field('주민등록번호','reg-rrn','type="password" inputmode="numeric" autocomplete="off" maxlength="14"'):'')+field('은행','reg-bank','placeholder="예: 국민은행" maxlength="30"')+field('계좌번호','reg-account','inputmode="numeric" autocomplete="off" maxlength="30"')+field('비밀번호 4자리','reg-pin','type="password" inputmode="numeric" autocomplete="new-password" maxlength="4"')+field('비밀번호 한 번 더','reg-confirm','type="password" inputmode="numeric" autocomplete="new-password" maxlength="4"')+'</div><details class="te-privacy"><summary>개인정보 수집·이용 안내</summary><p>'+escape(config.privacyNotice||'아직 설정되지 않았습니다.').replace(/\n/g,'<br>')+'</p>'+(config.rrnEnabled?'<p>주민등록번호 수집 근거: '+escape(config.rrnBasis)+'</p>':'')+'</details><label class="te-consent"><input id="reg-consent" type="checkbox">안내를 확인했고 수집·이용에 동의합니다.</label>'+button('등록하고 일당 입력하기','data-action="register" '+(!config.registrationEnabled?'disabled':'')))+back('로그인으로','login');}
function setupLogin(){return card('<h2>'+escape(me.name)+' 님, 새 로그인 정보를 설정하세요</h2><p class="te-note">이전에 저장한 공수와 일당은 그대로 유지됩니다.</p><div class="te-form">'+field('생년월일 6자리','setup-birth','inputmode="numeric" maxlength="6" placeholder="예: 900101"')+field('새 비밀번호 4자리','setup-pin','type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"')+field('비밀번호 한 번 더','setup-confirm','type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"')+'</div>'+button('새 로그인 정보 저장','data-action="setup-login"'));}
function settings(){return '<div class="te-section-label">작업자</div>'+button(me?'내 정보 보기':'작업자 로그인','data-go="'+(me?'profile':'login')+'"',true)+button('갤럭시·아이폰 앱 설치','data-go="install"',true)+'<div class="te-section-label">관리자 전용</div>'+button('관리자 모드 들어가기','data-go="'+(isAdmin?'admin':'adminLogin')+'"')+'<a class="te-plain-link" href="/privacy">개인정보 안내</a><p class="te-note">TOTAL ENG 근태 관리 · v1.1.0<br>공수와 금액은 작업자가 입력한 예상 내역입니다.</p>';}
function adminLogin(){return back('설정으로','settings')+card('<h2>관리자 비밀번호</h2>'+field('비밀번호','admin-password','type="password" autocomplete="current-password"')+button('관리자 화면 열기','data-action="admin-login"')+'<p class="te-note">관리자 인증은 20분 동안 유지됩니다.</p>');}
function admin(){return '<div class="te-section-label"><span class="te-badge warm">관리자 모드</span><button class="te-link" type="button" data-action="admin-logout">관리자 모드 종료</button></div>'+monthPicker()+row('등록 작업자',workers.length+'명')+(workers.length?'<div>'+workers.map(w=>'<button class="te-item" type="button" data-worker="'+w.id+'"><span class="te-avatar">'+escape(w.name[0])+'</span><span class="te-worker-name"><b>'+escape(w.name)+'</b><small>'+escape(w.phone)+'<br>'+fmt(w.units)+' 공수 · '+money(w.amount)+'원'+(w.unpriced?' · 일당 미설정 '+w.unpriced+'건':'')+'</small></span><span class="te-chevron">›</span></button>').join('')+'</div>':card('<h2>아직 등록된 작업자가 없어요</h2><p class="te-note">작업자가 가입하면 여기에 표시됩니다.</p>'));}
function recordDetail(r){return !r?'<p class="te-note">등록된 작업내역이 없습니다.</p>':'<article class="te-record-card"><div class="te-record-top"><strong>'+Number(r.date.slice(5,7))+'월 '+Number(r.date.slice(8))+'일</strong><span class="te-badge">'+(r.units===0?'휴무':fmt(r.units)+'공수')+'</span></div>'+(r.units===0?'':row('현장',r.site)+row('작업내용',r.work)+row('적용 일당',r.dailyRate===null?'미설정':money(r.dailyRate)+'원'))+row('작업 금액',r.amount===null?'일당 설정 후 계산':money(r.amount)+'원')+'</article>';}
function worker(){return back('작업자 목록','admin')+card('<h2>'+escape(active.name)+'</h2>'+row('생년월일',active.birthDate||'미설정')+row('전화번호',active.phone)+row('주민등록번호',active.rrn)+row('은행',active.bank)+row('계좌번호',active.account)+'<div id="sensitive-details"></div><button type="button" class="te-link" data-action="reveal">주민번호·계좌번호 전체 보기 (1분)</button>')+monthPicker()+summary(adminRecords)+'<div class="te-view-switch" role="group" aria-label="작업내역 보기 방식"><button type="button" data-view="calendar" aria-pressed="'+(detailMode==='calendar')+'">달력으로 보기</button><button type="button" data-view="list" aria-pressed="'+(detailMode==='list')+'">목록으로 보기</button></div>'+(detailMode==='calendar'?grid(adminRecords,true)+card('<h2>'+Number(selected.slice(5,7))+'월 '+Number(selected.slice(8))+'일 작업</h2>'+recordDetail(adminRecords.find(r=>r.date===selected))):card(adminRecords.length?adminRecords.map(recordDetail).join(''):'<p class="te-note">이번 달 작업내역이 없습니다.</p>'));}
function install(){const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),inApp=/KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV/i.test(navigator.userAgent),installed=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;return card('<h2>'+(installed?'이미 앱으로 실행 중이에요':'홈 화면에 추가하세요')+'</h2>'+(inApp?'<div class="te-wage-banner"><b>카카오톡 안에서는 설치가 안 보일 수 있어요</b><p>오른쪽 위 메뉴에서 다른 브라우저로 열기를 선택하세요. 아이폰은 Safari로 열어 주세요.</p></div>':'')+(installed?'':ios?'<ol class="te-install-steps"><li>Safari에서 이 주소를 엽니다.</li><li>공유 버튼을 누릅니다.</li><li>홈 화면에 추가 → 추가를 누릅니다.</li></ol>':'<ol class="te-install-steps"><li>Chrome 또는 삼성 인터넷에서 이 주소를 엽니다.</li><li>앱 설치 또는 메뉴의 홈 화면에 추가를 누릅니다.</li></ol>'+button('앱 설치하기','data-action="install"'))+'<p class="te-note">설치 후 생년월일 6자리와 비밀번호 4자리로 로그인하세요. 두 휴대폰에서도 같은 계정으로 기록을 확인할 수 있어요.</p>');}
function render(){
 const h=headings[page];document.getElementById('te-eyebrow').textContent=h[0];document.getElementById('te-title').textContent=h[1];document.getElementById('te-subtitle').textContent=h[2];main.innerHTML=({calendar,entry,wage,profile,settings,login,register,setupLogin,adminLogin,admin,worker,install})[page]();
 root.querySelectorAll('.te-bottom button').forEach(b=>b.setAttribute('aria-current',b.dataset.go===(['admin','worker','adminLogin','install'].includes(page)?'settings':page==='entry'?'calendar':page)?'page':'false'));
 if(page==='entry')updateCalc();
}
async function load(){
 if(page==='calendar'||page==='entry')records=(await api('/me/records?month='+month)).records;
 else if(page==='admin')workers=(await api('/admin/workers?month='+month)).workers;
 else if(page==='worker'){const result=await api('/admin/workers/'+active.id+'?month='+month);active=result.worker;adminRecords=result.records;}
}
async function navigate(next){
 if(['calendar','profile','entry','wage','setupLogin'].includes(next)&&!me)next='login';
 if(me?.needsLoginSetup&&['calendar','profile','entry','wage'].includes(next))next='setupLogin';
 if(['admin','worker'].includes(next)&&!isAdmin)next='adminLogin';
 if(page==='entry')readDraft();
 if(next==='entry'&&!draft)next='calendar';
 const prior=page;page=next;notify('');
 try{await load();render();window.scrollTo({top:0,behavior:'instant'});}catch(e){page=prior;throw e;}
}
async function loginSuccess(data){me=data.worker;month=today().slice(0,7);await navigate(me.dailyRate===null?'wage':'calendar');}
function value(id){return document.getElementById(id).value;}
async function action(name){
 if(name==='today'){month=today().slice(0,7);records=(await api('/me/records?month='+month)).records;notify('');openEntry(today());}
 if(name==='wage'){readDraft();fromWage=page;await navigate('wage');}
 if(name==='save-wage'){
  const raw=value('wage').replace(/,/g,'').trim();if(!/^\d+$/.test(raw))throw new Error('일당은 숫자로 입력해 주세요.');
  const result=await api('/me/rate','PUT',{dailyRate:Number(raw)});me.dailyRate=result.dailyRate;
  if(draft&&(!records.some(r=>r.date===selected)||draft.rate===null))draft.rate=me.dailyRate;
  const next=fromWage==='entry'?'entry':['profile','settings'].includes(fromWage)?fromWage:'calendar';await navigate(next);notify('일당을 저장했어요.');
 }
 if(name==='save-entry'){
  readDraft();if(!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(draft.units.trim()))throw new Error('공수를 숫자로 입력해 주세요.');
  await api('/me/records/'+selected,'PUT',{units:Number(draft.units),site:draft.site,work:draft.work});draft=null;await navigate('calendar');notify('공수를 저장했어요.');
 }
 if(name==='delete-entry'){if(!window.confirm('이 날짜의 공수와 작업내용을 삭제할까요?'))return;await api('/me/records/'+selected,'DELETE',{});draft=null;await navigate('calendar');notify('기록을 삭제했어요.');}
 if(name==='login')await loginSuccess(await api('/login','POST',{birthDate:value('login-birth'),pin:value('login-pin')}));
 if(name==='setup-login'){
  if(value('setup-pin')!==value('setup-confirm'))throw new Error('비밀번호가 서로 다릅니다.');
  const result=await api('/me/login','PUT',{birthDate:value('setup-birth'),pin:value('setup-pin')});await loginSuccess(result);notify('새 로그인 정보를 저장했어요.');
 }
 if(name==='register'){
  if(value('reg-pin')!==value('reg-confirm'))throw new Error('비밀번호가 서로 다릅니다.');
  fromWage='calendar';await loginSuccess(await api('/register','POST',{birthDate:value('reg-birth'),name:value('reg-name'),phone:value('reg-phone'),bank:value('reg-bank'),account:value('reg-account'),rrn:config.rrnEnabled?value('reg-rrn'):'',pin:value('reg-pin'),consent:document.getElementById('reg-consent').checked}));
 }
 if(name==='admin-login'){await api('/admin/login','POST',{password:value('admin-password')});isAdmin=true;await navigate('admin');}
 if(name==='admin-logout'){await api('/logout','POST',{role:'admin'});isAdmin=false;active=null;adminRecords=[];workers=[];await navigate('settings');}
 if(name==='logout'){await api('/logout','POST',{role:'worker'});me=null;records=[];draft=null;await navigate('login');}
 if(name==='reveal'){
  const data=await api('/admin/workers/'+active.id+'/sensitive'),target=document.getElementById('sensitive-details');if(!target)return;
  target.innerHTML=row('주민등록번호',data.rrn)+row('계좌번호',data.bank+' '+data.account);clearTimeout(revealTimer);revealTimer=setTimeout(()=>{if(target.isConnected)target.replaceChildren();},60000);
 }
 if(name==='install'){
  if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}
  else notify('브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택해 주세요.');
 }
}
root.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b||busy||b.disabled)return;
 busy=true;b.disabled=true;
 try{
  const d=b.dataset;
  if(d.go)await navigate(d.go);
  else if(d.date){notify('');openEntry(d.date);}
  else if(d.inspect){selected=d.inspect;render();}
  else if(d.unit!==undefined){readDraft();draft.units=d.unit;document.getElementById('entry-units').value=d.unit;updateCalc();}
  else if(d.month){const dt=new Date(month+'-01T12:00:00');dt.setMonth(dt.getMonth()+Number(d.month));month=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');selected=month+'-01';await load();render();}
  else if(d.worker){active=workers.find(w=>w.id===d.worker);selected=month+'-01';await navigate('worker');}
  else if(d.view){detailMode=d.view;localStorage.setItem('te-detail-mode',detailMode);render();}
  else if(d.action)await action(d.action);
 }catch(error){notify(error.message,true);if(!isAdmin&&['admin','worker'].includes(page)){page='adminLogin';render();}else if(!me&&['calendar','entry','profile','wage','setupLogin'].includes(page)){page='login';render();}}
 finally{busy=false;if(b.isConnected)b.disabled=false;}
});
root.addEventListener('input',e=>{if(page==='entry'&&['entry-units','entry-site','entry-work'].includes(e.target.id)){readDraft();updateCalc();}});
root.addEventListener('keydown',e=>{if(e.key==='Enter'&&['login','adminLogin','wage'].includes(page)){e.preventDefault();root.querySelector('[data-action="'+({login:'login',adminLogin:'admin-login',wage:'save-wage'})[page]+'"]').click();}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('offline',()=>notify('인터넷 연결이 없습니다. 저장하려면 다시 연결해 주세요.',true));
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
(async()=>{try{config=await api('/config');const s=await api('/session');me=s.worker;isAdmin=s.admin;page=me?(me.needsLoginSetup?'setupLogin':'calendar'):'login';await load();render();notify('');}catch(error){main.innerHTML=card('<h2>연결을 확인해 주세요</h2>'+button('다시 불러오기','data-action="reload"'));notify(error.message,true);}})();
root.addEventListener('click',e=>{if(e.target.closest('[data-action="reload"]'))location.reload();});
})();
