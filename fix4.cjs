const fs = require('fs');
let s2 = fs.readFileSync('server.ts', 'utf8');
s2 = s2.replace(/30000,/g, '90000,');
fs.writeFileSync('server.ts', s2);
