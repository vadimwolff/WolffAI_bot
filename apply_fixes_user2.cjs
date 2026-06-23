const fs = require('fs');

let pb = fs.readFileSync('platformBot.ts', 'utf8');
let s = fs.readFileSync('server.ts', 'utf8');

pb = pb.replace(/prices: \[\{ label: "PRO Подписка 1 месяц", amount: 100 \}\]/g, 'prices: [{ label: "PRO Подписка 2 месяца", amount: 150 }]');
s = s.replace(/prices: \[\{ label: "1 месяц", amount: 150 \}\]/g, 'prices: [{ label: "2 месяца", amount: 150 }]');

fs.writeFileSync('platformBot.ts', pb);
fs.writeFileSync('server.ts', s);
