const fs = require('fs');
let s = fs.readFileSync('server.ts', 'utf8');

s = s.replace(/💎 <b>PRO и Бонусы:<\/b>\\n/g, 
"💎 <b>PRO и Бонусы:</b>\\nПри покупке PRO вы получаете экосистему из ботов с ИИ: Мультимодельная платформа WolffAI Platform, обычный WolffAI, Злой AngryAI и генератор картинок ImageBot!\\n");

fs.writeFileSync('server.ts', s);
