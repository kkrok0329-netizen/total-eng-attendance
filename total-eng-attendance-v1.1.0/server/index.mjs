import { existsSync } from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
const {createApp}=await import('./app.mjs');
try{
 const app=await createApp();
 const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
 app.server.listen(port,host,()=>console.log(`TOTAL ENG 근태 관리: http://${host}:${port}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}catch(error){console.error('앱을 시작하지 못했습니다:',error.message);process.exitCode=1;}
