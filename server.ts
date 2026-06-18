import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";

const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "users.json");

// Define database schema
interface User {
  id: number;
  username?: string;
  firstName?: string;
  refCount: number;
  referredBy?: number;
  joinedAt: string;
}

let users: Record<string, User> = {};

// Load DB
if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    users = JSON.parse(data);
  } catch (e) {
    console.error("Error reading users.json:", e);
  }
}

// Save DB function
const saveDB = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
};

async function startServer() {
  const app = express();

  // --- BOT INITIALIZATION ---
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  
  // Create Bot
  let bot: Telegraf | null = null;
  let ai: GoogleGenAI | null = null;

  if (geminiKey) {
    ai = new GoogleGenAI({ apiKey: geminiKey });
  } else {
    console.warn("GEMINI_API_KEY is not set. Bot AI features will be disabled.");
  }

  if (botToken) {
    bot = new Telegraf(botToken);

    // Command: /start
    bot.start((ctx) => {
      const userId = ctx.from.id;
      const refPayload = ctx.payload; // the REF_ID from /start REF_ID
      
      let isNewUser = false;
      if (!users[userId]) {
        isNewUser = true;
        let referredBy: number | undefined;
        
        if (refPayload) {
          const inviterId = parseInt(refPayload, 10);
          if (!isNaN(inviterId) && users[inviterId] && inviterId !== userId) {
            referredBy = inviterId;
            users[inviterId].refCount += 1;
            // Notify the inviter
            ctx.telegram.sendMessage(inviterId, `🎉 По вашей реферальной ссылке зарегистрировался новый пользователь: ${ctx.from.first_name}!`).catch(() => {});
          }
        }
        
        users[userId] = {
          id: userId,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          refCount: 0,
          referredBy,
          joinedAt: new Date().toISOString(),
        };
        saveDB();
      }

      ctx.reply(
        `👋 Привет, ${ctx.from.first_name}! Я *WolffAi* — твой умный и быстрый ИИ ассистент.\n\n` + 
        `Напиши мне любой вопрос, и я быстро на него отвечу!\n\n` +
        `У меня также есть реферальная система: введи /referral чтобы приглашать друзей.`,
        { parse_mode: "Markdown" }
      );
    });

    // Command: /referral
    bot.command("referral", (ctx) => {
      const userId = ctx.from.id;
      const user = users[userId];
      if (!user) return;
      
      const botUsername = ctx.botInfo.username;
      const refLink = `https://t.me/${botUsername}?start=${userId}`;
      
      ctx.reply(
        `🔗 *Твоя реферальная программа*\n\n` +
        `Приглашено друзей: *${user.refCount}*\n\n` +
        `Отправь эту ссылку друзьям:\n${refLink}\n\n` + 
        `_💡 Совет: в будущем мы планируем добавить награды за каждого приглашенного активного пользователя._`,
        { parse_mode: "Markdown" }
      );
    });

    // Command: /broadcast (Admin only)
    bot.command("broadcast", async (ctx) => {
      if (!adminIdStr || String(ctx.from.id) !== adminIdStr.trim()) {
        return ctx.reply("❌ У вас нет прав на эту команду.");
      }
      
      const text = ctx.message.text.replace("/broadcast", "").trim();
      if (!text) {
        return ctx.reply("Формат: /broadcast Текст сообщения");
      }
      
      ctx.reply("Начинаю рассылку...");
      let success = 0;
      let fails = 0;
      
      for (const uid of Object.keys(users)) {
        try {
          await ctx.telegram.sendMessage(uid, `📢 *Объявление от администратора:*\n\n${text}`, { parse_mode: "Markdown" });
          success++;
        } catch(e) {
          fails++;
        }
      }
      
      ctx.reply(`✅ Рассылка завершена.\nУспешно: ${success}\nОшибок: ${fails}`);
    });

    // Handle Text Messages
    bot.on(message("text"), async (ctx) => {
      if (!ai) {
        return ctx.reply("К сожалению, ИИ сейчас недоступен (не настроен ключ).");
      }

      const text = ctx.message.text;
      
      // typing action
      ctx.sendChatAction("typing");

      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text }] }],
          config: {
            systemInstruction: "Ты WolffAi, умный, дерзкий и полезный ассистент. Отвечай кратко, четко, только на русском языке.",
          }
        });

        const replyText = response.text || "Нет ответа от ИИ.";
        
        // ADVERTISING BLOCK
        const adBlock = `\n\n---\n🚀 *Спонсорский блок:*\n*Хочешь запустить свой проект и зарабатывать?* [Узнай как автоматизировать свой бизнес!](https://t.me/)`;
        
        ctx.reply(replyText + adBlock, { parse_mode: "Markdown", disable_web_page_preview: true });
        
      } catch (err: any) {
        console.error("Gemini Error:", err);
        ctx.reply("Извините, произошла ошибка при обращении к ИИ.");
      }
    });

    bot.launch().then(() => console.log("Telegram bot started.")).catch(console.error);

    // Enable graceful stop
    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.log("TELEGRAM_BOT_TOKEN not provided, skipping Telegram bot setup.");
  }


  // --- EXPRESS ROUTES ---
  app.get("/api/stats", (req, res) => {
    res.json({
      totalUsers: Object.keys(users).length,
      botActive: !!botToken
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
