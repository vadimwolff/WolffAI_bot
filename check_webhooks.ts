import { Telegraf } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const angryBotToken = process.env.ANGRY_TELEGRAM_BOT_TOKEN;

async function checkWebhooks() {
  if (botToken) {
    const b = new Telegraf(botToken);
    try {
      const info = await b.telegram.getWebhookInfo();
      console.log("Wolff Bot Webhook Info:", info);
    } catch (e) {
      console.error("Wolff Bot Webhook Info Error:", e);
    }
  } else {
    console.log("TELEGRAM_BOT_TOKEN is missing");
  }

  if (angryBotToken) {
    const b = new Telegraf(angryBotToken);
    try {
      const info = await b.telegram.getWebhookInfo();
      console.log("Angry Bot Webhook Info:", info);
    } catch (e) {
      console.error("Angry Bot Webhook Info Error:", e);
    }
  } else {
    console.log("ANGRY_TELEGRAM_BOT_TOKEN is missing");
  }
}

checkWebhooks();
