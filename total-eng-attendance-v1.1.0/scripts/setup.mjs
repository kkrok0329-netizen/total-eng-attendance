import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
if(existsSync('.env')){console.error('.env가 이미 있습니다. 기존 키와 비밀번호를 보존하기 위해 중단합니다.');process.exit(1);}
const env=`NODE_ENV=development
PORT=3000
HOST=127.0.0.1
APP_ORIGIN=http://127.0.0.1:3000
DOMAIN=attendance.example.com
DATA_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}
ADMIN_PASSWORD=${randomBytes(18).toString('base64url')}
DB_PATH=./data/attendance.sqlite
PRIVACY_NOTICE=
COLLECT_RRN=false
RRN_COLLECTION_BASIS=
`;
writeFileSync('.env',env,{flag:'wx',mode:0o600});mkdirSync('data',{recursive:true});
console.log('.env를 생성했습니다. 관리자 비밀번호는 .env에서 확인하세요.');
console.log('개인정보 수집 안내를 설정한 후 npm start로 로컬 실행하세요. 실제 배포는 DEPLOY.md를 참고하세요.');
