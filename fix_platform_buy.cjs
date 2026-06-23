const fs = require('fs');
let pb = fs.readFileSync('platformBot.ts', 'utf8');

const bpReplacement = `
  bot.command("buypro", (ctx) => {
    const u = getInitPlatformUser(ctx);
    if (u.isSubscribed) {
      return ctx.reply("💎 У вас уже активирован PRO статус! Вы пользуетесь ботом без ограничений.");
    }
    return sendProInvoice(ctx);
  });
`;

pb = pb.replace(/bot\.command\("buypro", sendProInvoice\);/g, bpReplacement);

fs.writeFileSync('platformBot.ts', pb);
