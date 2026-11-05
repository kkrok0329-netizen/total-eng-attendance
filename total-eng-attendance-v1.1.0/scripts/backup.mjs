import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
if(existsSync('.env'))process.loadEnvFile('.env');
const source=process.env.DB_PATH||'./data/attendance.sqlite';
if(!existsSync(source))throw new Error('백업할 데이터베이스가 없습니다.');
const dir=process.env.BACKUP_DIR||'./backups';mkdirSync(dir,{recursive:true});
const target=resolve(dir,'attendance-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,target);console.log('데이터베이스 백업 완료:',target);console.log('복구하려면 기존 DATA_ENCRYPTION_KEY도 필요합니다. 키는 별도의 안전한 장소에 보관하세요.');}finally{db.close();}
