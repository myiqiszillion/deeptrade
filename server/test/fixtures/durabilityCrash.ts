import '../../../scripts/offline_guard.cjs';
import { MarketDataStore } from '../../src/storage/marketDataStore.js';
const [path, mode] = process.argv.slice(2);
const store = new MarketDataStore(path);
const db = (store as any).db;
const exec = db.exec.bind(db);
db.exec = (sql: string) => {
  if (sql === 'COMMIT' && mode === 'before') process.exit(71);
  const value = exec(sql);
  if (sql === 'COMMIT' && mode === 'after') process.exit(72);
  return value;
};
const result = store.saveTrades([{id:'crash-fixture',timestamp:1791910000000,price:5000,size:7,side:'buy'}], 'ES', 'fixture');
if (result.status !== 'COMMITTED') process.exit(73);
process.exit(74);
