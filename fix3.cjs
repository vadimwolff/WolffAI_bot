const fs = require('fs');

let s = fs.readFileSync('platformBot.ts', 'utf8');
s = s.replace(/25000/g, '90000');
fs.writeFileSync('platformBot.ts', s);

let s2 = fs.readFileSync('server.ts', 'utf8');
s2 = s2.replace(/25000/g, '90000');
fs.writeFileSync('server.ts', s2);
