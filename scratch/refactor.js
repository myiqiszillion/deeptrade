const fs = require('fs');

const filePath = './server/src/marketData/marketContext.ts';
let content = fs.readFileSync(filePath, 'utf8');

const regex = /session\.subscribedTimeframe/g;
content = content.replace(regex, 'session.getTimeframe(this.symbol)');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Refactored subscribedTimeframe calls.');
