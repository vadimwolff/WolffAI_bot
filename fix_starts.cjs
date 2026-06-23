const fs = require('fs');
let s = fs.readFileSync('server.ts', 'utf8');

s = s.replace(/👋 Добро пожаловать, <b>\$\{ctx\.from\.first_name\}<\/b>!/g, "👋 Добро пожаловать, <b>${ctx.from.first_name}</b>!${u.isSubscribed ? ' 💎 <b>[PRO]</b>' : ''}");

s = s.replace(/😡 Ну че приперся, \$\{ctx\.from\.first_name\}\?\nn/g, "😡 Ну че приперся, ${ctx.from.first_name}?${u.isSubscribed ? ' Я вижу твой 💎 PRO, но это не спасет от моего презрения.' : ''}\\n\\n");

s = s.replace(/bot\.command\("status", \(ctx\) => {/g, "bot.command(\"status\", (ctx) => {");

fs.writeFileSync('server.ts', s);
