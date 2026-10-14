import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const d=new DatabaseSync('/app/data/market_data.sqlite',{readOnly:true});
console.log(JSON.stringify({trades:d.prepare('select count(*) n from trades').get().n,bars:d.prepare('select count(*) n from bars').get().n,integrity:d.prepare('pragma integrity_check').get(),fk:d.prepare('pragma foreign_key_check').all().length,schema:createHash('sha256').update(JSON.stringify(d.prepare('pragma table_info(trades)').all())).digest('hex'),provider:process.env.FUTURES_PROVIDER,keyEmpty:!process.env.DATABENTO_API_KEY,start:process.env.DATABENTO_RUNTIME_START,profileEmpty:!process.env.DATABENTO_RUNTIME_PROFILE}));d.close();
