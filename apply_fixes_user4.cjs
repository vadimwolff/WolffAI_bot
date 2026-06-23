const fs = require('fs');
let pb = fs.readFileSync('platformBot.ts', 'utf8');

pb = pb.replace(/100 Stars \/ мес/g, '150 Stars \/ 2 мес');
pb = pb.replace(/🌟 Оформите <b>PRO подписку на 2 месяца за 150 звезд \(Telegram Stars\)<\/b> для полной отмены лимитов или продолжайте пользоваться бесплатным стандартным ИИ-ботом\.\\n\\n/g, 
"🌟 Оформите <b>PRO подписку на 2 месяца за 150 звезд</b>. При покупке PRO вы получаете безлимитный доступ ко всей экосистеме ботов с ИИ: Мультимодельная платформа (WolffAI Platform), Базовый бот (WolffAI), Злой бот (AngryAI) и Художник (ImageBot)!\\n\\n");

fs.writeFileSync('platformBot.ts', pb);
