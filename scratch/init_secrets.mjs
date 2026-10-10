import crypto from 'node:crypto';
import fs from 'node:fs';

const envPath = '.env';
let content = fs.readFileSync(envPath, 'utf8');

const jwtSecret = crypto.randomBytes(32).toString('hex');
const adminSecret = crypto.randomBytes(32).toString('hex');
const metricsToken = crypto.randomBytes(32).toString('hex');

content = content.replace(/^AUTH_JWT_SECRET=.*$/m, `AUTH_JWT_SECRET=${jwtSecret}`);
content = content.replace(/^ADMIN_SECRET=.*$/m, `ADMIN_SECRET=${adminSecret}`);
content = content.replace(/^METRICS_TOKEN=.*$/m, `METRICS_TOKEN=${metricsToken}`);

fs.writeFileSync(envPath, content, 'utf8');
console.log('Secrets updated successfully.');
