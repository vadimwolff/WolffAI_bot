import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
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
  mode: 'fast' | 'thinking' | 'code' | 'search';
  messagesToday: number;
  lastMessageDate: string;
  isSubscribed: boolean;
  history: Array<{ role: 'user' | 'model', parts: Array<any> }>;
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

const getInitUser = (ctx: any): User => {
  const userId = ctx.from.id;
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      refCount: 0,
      joinedAt: new Date().toISOString(),
      mode: 'fast',
      messagesToday: 0,
      lastMessageDate: new Date().toISOString().split('T')[0],
      isSubscribed: false,
      history: []
    };
  }
  
  // ensure new fields exist for old users
  if (!users[userId].mode) users[userId].mode = 'fast';
  if (users[userId].messagesToday === undefined) users[userId].messagesToday = 0;
  if (!users[userId].lastMessageDate) users[userId].lastMessageDate = new Date().toISOString().split('T')[0];
  if (users[userId].isSubscribed === undefined) users[userId].isSubscribed = false;
  if (!users[userId].history) users[userId].history = [];
  
  saveDB();
  return users[userId];
}

const checkLimit = (user: User): boolean => {
  if (user.isSubscribed) return true;
  const today = new Date().toISOString().split('T')[0];
  if (user.lastMessageDate !== today) {
    user.messagesToday = 0;
    user.lastMessageDate = today;
  }
  if (user.messagesToday >= 10) return false;
  user.messagesToday += 1;
  saveDB();
  return true;
}

async function startServer() {
  const app = express();

  // --- BOT INITIALIZATION ---
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  
  let bot: Telegraf | null = null;
  let ai: GoogleGenAI | null = null;

  if (geminiKey) {
    ai = new GoogleGenAI({ apiKey: geminiKey });
  } else {
    console.warn("GEMINI_API_KEY is not set. Bot AI will fail.");
  }

  if (botToken) {
    bot = new Telegraf(botToken);

    // Command: /start
    bot.start((ctx) => {
      const u = getInitUser(ctx);
      const userId = ctx.from.id;
      const refPayload = ctx.payload; // from /start REF_ID
      
      if (refPayload && u.refCount === 0 && u.joinedAt.startsWith(new Date().toISOString().split('T')[0])) {
        const inviterId = parseInt(refPayload, 10);
        if (!isNaN(inviterId) && users[inviterId] && inviterId !== userId) {
          u.referredBy = inviterId;
          users[inviterId].refCount += 1;
          ctx.telegram.sendMessage(inviterId, `🎉 По вашей ссылке зарегистрировался: ${ctx.from.first_name}!`).catch(() => {});
          saveDB();
        }
      }

      ctx.reply(
        `👋 Привет, <b>${ctx.from.first_name}</b>! Я <b>WolffAi</b> — твой умный ИИ.\n\n` + 
        `Я помню контекст беседы, отправляй мне текст или фото!\n` +
        `• /mode - Выбрать режим (Мышление, Поиск, Код)\n` +
        `• /clear - Очистить контекст\n` + 
        `• /buy - Безлимитный PRO (Stars)\n` + 
        `• /referral - Пригласить друзей`,
        { parse_mode: "HTML" }
      ).catch(console.error);
    });

    // Command: /clear
    bot.command("clear", (ctx) => {
      const u = getInitUser(ctx);
      u.history = [];
      saveDB();
      ctx.reply("🧹 Контекст беседы очищен! Начинаем с чистого листа.");
    });

    // Command: /mode
    bot.command("mode", (ctx) => {
      const u = getInitUser(ctx);
      ctx.reply(`Текущий режим: <b>${u.mode}</b>\nВыберите новый режим:`, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("⚡ Быстрый", "mode_fast"), Markup.button.callback("🧠 Мышление", "mode_thinking")],
          [Markup.button.callback("💻 Код", "mode_code"), Markup.button.callback("🔍 Поиск", "mode_search")]
        ])
      });
    });

    bot.action(/mode_(.*)/, (ctx) => {
      const u = getInitUser(ctx);
      const newMode = ctx.match[1] as any;
      u.mode = newMode;
      saveDB();
      ctx.answerCbQuery(`Режим изменен: ${newMode}`);
      ctx.editMessageText(`✅ Режим работы изменен на: <b>${newMode}</b>`, { parse_mode: "HTML" }).catch(()=>{});
    });

    // Command: /referral
    bot.command("referral", async (ctx) => {
      const u = getInitUser(ctx);
      const botUsername = ctx.botInfo?.username || "ТвойБот";
      const refLink = `https://t.me/${botUsername}?start=${u.id}`;
      
      await ctx.reply(
        `🔗 <b>Твоя реферальная программа</b>\n\n` +
        `Приглашено друзей: <b>${u.refCount}</b>\n\n` +
        `Отправь эту ссылку:\n${refLink}\n` + 
        `<i>Зарабатывай награды (в разработке).</i>`,
        { parse_mode: "HTML" }
      ).catch(console.error);
    });

    // Command: /promo
    bot.command("promo", (ctx) => {
      const u = getInitUser(ctx);
      const parts = ctx.message.text.split(" ");
      if (parts.length < 2) return ctx.reply("❌ Введите промокод, например: /promo CODE");
      
      const code = parts[1].toUpperCase();
      if (code === "MAXVERSTAPPENBEST" || code === "KOSTASDEBIL") {
         u.isSubscribed = true;
         saveDB();
         ctx.reply("🎉 Промокод применен! У вас теперь БЕЗЛИМИТНЫЙ PRO статус.");
      } else {
         ctx.reply("❌ Неверный промокод.");
      }
    });

    // Command: /buy (Telegram Stars)
    bot.command("buy", (ctx) => {
      ctx.replyWithInvoice({
        title: "Подписка PRO",
        description: "Безлимитный доступ, все режимы ИИ и возможности.",
        payload: "sub_1_month",
        provider_token: "", // Native Telegram Stars
        currency: "XTR",
        prices: [{ label: "1 месяц", amount: 150 }] // 150 Telegram Stars
      }).catch(e => console.error("Invoice Error:", e));
    });

    bot.on("pre_checkout_query", async (ctx) => {
      await ctx.answerPreCheckoutQuery(true).catch(console.error);
    });

    bot.on(message("successful_payment"), async (ctx) => {
      const u = getInitUser(ctx);
      u.isSubscribed = true;
      saveDB();
      await ctx.reply("🎉 Оплата (Stars) успешна! Твой PRO доступ активирован навсегда!");
    });

    bot.command("broadcast", async (ctx) => {
      if (!adminIdStr || String(ctx.from.id) !== adminIdStr.trim()) return;
      const text = ctx.message.text.replace("/broadcast", "").trim();
      if (!text) return ctx.reply("Формат: /broadcast text");
      let s = 0, f = 0;
      for (const uid of Object.keys(users)) {
        try {
          await ctx.telegram.sendMessage(uid, `📢 <b>Рассылка:</b>\n${text}`, { parse_mode: "HTML" });
          s++;
        } catch(e) { f++; }
      }
      ctx.reply(`✅ Рассылка: ${s} успешно, ${f} ошибок`);
    });

    // Main AI Engine Handler
    const handleInput = async (ctx: any, text: string) => {
      const u = getInitUser(ctx);
      
      if (!checkLimit(u)) {
        return ctx.reply("❌ Дневной лимит 10 сообщений исчерпан( Купите подписку командой /buy или введите /promo");
      }

      if (!ai) return ctx.reply("ИИ отключен сервером.");
      ctx.sendChatAction("typing");

      try {
        let parts: any[] = [];
        if (text) parts.push({ text });

        if (ctx.message.photo) {
           const photo = ctx.message.photo.pop();
           const fileLink = await ctx.telegram.getFileLink(photo.file_id);
           const res = await fetch(fileLink.toString());
           if (res.ok) {
             const buf = await res.arrayBuffer();
             parts.push({
               inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: "image/jpeg" }
             });
           }
        }

        if (parts.length === 0) return;

        u.history.push({ role: "user", parts });
        if (u.history.length > 10) u.history = u.history.slice(u.history.length - 10);

        let tools = undefined;
        let model = "gemini-2.5-flash";
        let sysInst = "Ты WolffAi, дерзкий, умный компаньон. Отвечай кратко, русском.";

        if (u.mode === "search") {
           tools = [{ googleSearch: {} }];
        } else if (u.mode === "thinking") {
           model = "gemini-2.5-pro";
           sysInst = "Ты WolffAi, мощный аналитик. Глубоко продумывай ответ.";
        } else if (u.mode === "code") {
           sysInst = "Ты WolffAi Senior Кодер. Приводи код, лучшие практики.";
        }

        const response = await ai.models.generateContent({
           model,
           contents: u.history,
           config: { 
             systemInstruction: sysInst,
             tools: tools
           }
        });

        const replyText = response.text || "Нет ответа.";
        
        u.history.push({ role: "model", parts: [{ text: replyText }] });
        saveDB();

        const adBlock = `\n\n---\n🚀 <b>Спонсор</b>: <a href="https://t.me/">Запустить свой проект</a>`;
        await ctx.reply(replyText + adBlock, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
          await ctx.reply(replyText + "\n\n--- Спонсор: https://t.me/");
        });

      } catch (err: any) {
        console.error("Gemini Error:", err);
        u.history.pop(); // Revert user query to not corrupt history
        ctx.reply("❌ Произошла ошибка. Слишком сложный запрос (или переполнение контекста). Попробуйте написать короче или /clear");
      }
    };

    bot.on(message("text"), (ctx) => handleInput(ctx, ctx.message.text));
    bot.on(message("photo"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));

    bot.launch().then(() => console.log("Bot started")).catch(console.error);

    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.log("TELEGRAM_BOT_TOKEN missing");
  }

  // --- EXPRESS ROUTES ---
  app.get("/api/stats", (req, res) => {
    res.json({
      totalUsers: Object.keys(users).length,
      botActive: !!botToken
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
