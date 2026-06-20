import { Telegraf } from 'telegraf';

async function clearWebhooks() {
  const tokens = [
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.ANGRY_TELEGRAM_BOT_TOKEN,
    process.env.PLATFORM_TELEGRAM_BOT_TOKEN
  ];

  for (const token of tokens) {
    if (!token) continue;
    const bot = new Telegraf(token);
    try {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      console.log(`Deleted webhook for bot: ${(await bot.telegram.getMe()).username}`);
    } catch (e) {
      console.error(`Failed: ${e.message}`);
    }
  }
}
clearWebhooks();
