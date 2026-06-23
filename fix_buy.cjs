const fs = require('fs');
let s = fs.readFileSync('server.ts', 'utf8');

const buyCmd = `    bot.command("buy", (ctx) => {
      const u = getInitUser(ctx);
      if (u.isSubscribed) {
        return ctx.reply("💎 У вас уже активирован PRO статус! Вы пользуетесь ботом без ограничений.");
      }
      ctx.replyWithInvoice({`;

s = s.replace(/bot\.command\("buy", \(ctx\) => \{\n      ctx\.replyWithInvoice\(\{/g, buyCmd);

fs.writeFileSync('server.ts', s);
