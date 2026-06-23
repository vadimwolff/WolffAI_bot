const fs = require('fs');

let s = fs.readFileSync('server.ts', 'utf8');

s = s.replace(/150₽ \/ месяц/g, '150 звезд / 2 месяца');

fs.writeFileSync('server.ts', s);
