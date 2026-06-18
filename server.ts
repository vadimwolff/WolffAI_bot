import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";

const PORT = 3000;
const DB_FILE = path.join(process.cwd(), "users.json");

interface ChatSession {
  id: string;
  name: string;
  history: Array<{ role: 'user' | 'model', parts: Array<any> }>;
}

interface User {
  id: number;
  username?: string;
  firstName?: string;
  refCount: number;
  referredBy?: number;
  joinedAt: string;
  mode: 'fast' | 'thinking' | 'code' | 'search';
  modelPreference: 'gemini-2' | 'gemini-3';
  messagesToday: number;
  messagesFast?: number;
  messagesThinking?: number;
  messagesSearch?: number;
  lastMessageDate: string;
  isSubscribed: boolean;
  chats: Record<string, ChatSession>;
  currentChatId: string;
}

let users: Record<string, User> = {};

if (fs.existsSync(DB_FILE)) {
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    users = JSON.parse(data);
  } catch (e) {
    console.error("Error reading users.json:", e);
  }
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));

const getInitUser = (ctx: any): User => {
  const userId = ctx.from.id;
  const defaultChatId = Date.now().toString();
  
  if (!users[userId]) {
    users[userId] = {
      id: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      refCount: 0,
      joinedAt: new Date().toISOString(),
      mode: 'fast',
      modelPreference: 'gemini-3',
      messagesToday: 0,
      lastMessageDate: new Date().toISOString().split('T')[0],
      isSubscribed: false,
      chats: {
        [defaultChatId]: { id: defaultChatId, name: "Новый чат", history: [] }
      },
      currentChatId: defaultChatId
    };
  }
  
  const u = users[userId];
  
  if (!u.mode) u.mode = 'fast';
  if (!u.modelPreference) u.modelPreference = 'gemini-3';
  if (u.messagesToday === undefined) u.messagesToday = 0;
  if (u.messagesFast === undefined) u.messagesFast = 0;
  if (u.messagesThinking === undefined) u.messagesThinking = 0;
  if (u.messagesSearch === undefined) u.messagesSearch = 0;
  if (!u.lastMessageDate) u.lastMessageDate = new Date().toISOString().split('T')[0];
  if (u.isSubscribed === undefined) u.isSubscribed = false;
  
  if (!u.chats) {
    const oldHistory = (u as any).history || [];
    u.chats = {
      [defaultChatId]: { id: defaultChatId, name: "Первый чат", history: oldHistory }
    };
    u.currentChatId = defaultChatId;
    delete (u as any).history;
  }
  
  if (!u.chats[u.currentChatId]) {
     u.currentChatId = Object.keys(u.chats)[0] || defaultChatId;
     if (!u.chats[u.currentChatId]) {
         u.chats[u.currentChatId] = { id: u.currentChatId, name: "Новый чат", history: [] };
     }
  }
  
  saveDB();
  return users[userId];
}

const checkLimit = (user: User, mode: string): boolean => {
  const today = new Date().toISOString().split('T')[0];
  if (user.lastMessageDate !== today) {
    user.messagesToday = 0;
    user.messagesFast = 0;
    user.messagesThinking = 0;
    user.messagesSearch = 0;
    user.lastMessageDate = today;
  }
  
  if (mode === 'thinking') {
     const thinkingLimit = user.isSubscribed ? 100 : 5;
     if ((user.messagesThinking || 0) >= thinkingLimit) return false;
     user.messagesThinking = (user.messagesThinking || 0) + 1;
  } else if (mode === 'search') {
     if (!user.isSubscribed && (user.messagesSearch || 0) >= 50) return false;
     user.messagesSearch = (user.messagesSearch || 0) + 1;
  } else {
     user.messagesFast = (user.messagesFast || 0) + 1;
  }
  
  saveDB();
  return true;
}

async function startServer() {
  const app = express();

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  
  let bot: Telegraf | null = null;
  let ai: GoogleGenAI | null = null;

  if (geminiKey) ai = new GoogleGenAI({ apiKey: geminiKey });
  else console.warn("GEMINI_API_KEY is not set.");

  if (botToken) {
    bot = new Telegraf(botToken);

    bot.start((ctx) => {
      const u = getInitUser(ctx);
      const userId = ctx.from.id;
      const refPayload = ctx.payload; 
      
      if (refPayload && u.refCount === 0 && u.joinedAt.startsWith(new Date().toISOString().split('T')[0])) {
        const inviterId = parseInt(refPayload, 10);
        if (!isNaN(inviterId) && users[inviterId] && inviterId !== userId) {
          u.referredBy = inviterId;
          users[inviterId].refCount += 1;
          
          if (users[inviterId].refCount >= 3 && !users[inviterId].isSubscribed) {
             users[inviterId].isSubscribed = true;
             ctx.telegram.sendMessage(inviterId, `🎉 Ура! Вы пригласили 3 друзей и получили БЕЗЛИМИТНЫЙ PRO статус на месяц!`).catch(() => {});
          } else {
             ctx.telegram.sendMessage(inviterId, `🎉 По вашей ссылке зарегистрировался: ${ctx.from.first_name}! Приглашено друзей: ${users[inviterId].refCount}/3`).catch(() => {});
          }
          saveDB();
        }
      }

      ctx.reply(
        `👋 Добро пожаловать, <b>${ctx.from.first_name}</b>!\n\n` +
        `Я <b>WolffAi</b> — ваш умный ИИ-ассистент. Я готов помочь с текстами, кодом, поиском информации и решением сложных задач, надежно сохраняя историю ваших бесед.\n\n` +
        `⚙️ <b>Режимы работы (/mode):</b>\n` +
        `⚡ <b>Быстрый</b> — мгновенные и точные ответы.\n` +
        `🧠 <b>Мышление</b> — вдумчивый анализ сложных проблем.\n` +
        `🔍 <b>Поиск</b> — работа со свежими данными из сети.\n\n` +
        `🛠 <b>Команды:</b>\n` +
        `• /newchat [имя] — Создать новый чат\n` +
        `• /chats — Управление чатами\n` +
        `• /clear — Очистить сообщения диалога\n\n` +
        `💎 <b>PRO и Бонусы:</b>\n` +
        `• /buy — Безлимитный доступ (150₽ / месяц)\n` +
        `• /referral — Зови друзей и получи PRO бесплатно\n` +
        `• /promo [код] — Ввод промокода\n\n` +
        `Напишите свой первый вопрос, чтобы начать! 👇`,
        { parse_mode: "HTML" }
      ).catch(console.error);
    });

    bot.command("clear", (ctx) => {
      const u = getInitUser(ctx);
      u.chats[u.currentChatId].history = [];
      saveDB();
      ctx.reply("🧹 Контекст текущего чата очищен!");
    });

    bot.command("newchat", async (ctx) => {
      try {
        const u = getInitUser(ctx);
        const text = (ctx.message as any)?.text || "";
        const parts = text.split(" ");
        parts.shift(); // remove command
        const name = parts.length > 0 ? parts.join(" ") : `Чат ${Object.keys(u.chats).length + 1}`;
        
        const newId = Date.now().toString();
        u.chats[newId] = { id: newId, name, history: [] };
        u.currentChatId = newId;
        saveDB();
        await ctx.reply(`✅ Создан и выбран новый чат: <b>${name}</b>`, { parse_mode: "HTML" });
      } catch (err) {
        console.error("New Chat Error:", err);
      }
    });

    bot.command("chats", async (ctx) => {
      try {
        const u = getInitUser(ctx);
        const chatList = Object.values(u.chats).slice(-20); // show up to 20 recent chats
        
        const buttons = chatList.map(c => {
           const prefix = c.id === u.currentChatId ? "👉 " : "";
           return [Markup.button.callback(`${prefix}${c.name}`, `switchchat_${c.id}`)];
        });
        
        await ctx.reply(`Ваши активные чаты (текущий выделен):`, Markup.inlineKeyboard(buttons));
      } catch (err) {
        console.error("Chats Error:", err);
      }
    });

    bot.action(/switchchat_(.*)/, async (ctx) => {
      try {
        const u = getInitUser(ctx);
        const chatId = ctx.match[1];
        if (u.chats[chatId]) {
           u.currentChatId = chatId;
           saveDB();
           await ctx.answerCbQuery(`Чат переключен на ${u.chats[chatId].name}`).catch(()=>{});
           await ctx.editMessageText(`✅ Вы переключились на чат: <b>${u.chats[chatId].name}</b>`, { parse_mode: "HTML" }).catch(()=>{});
        } else {
           await ctx.answerCbQuery(`Чат не найден`).catch(()=>{});
        }
      } catch (err) {
        console.error("Switch Chat Error:", err);
      }
    });

    bot.command("mode", async (ctx) => {
      try {
        const u = getInitUser(ctx);
        await ctx.reply(`Текущий режим: <b>${u.mode}</b>\nВыберите новый режим:`, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("⚡ Быстрый", "mode_fast"), Markup.button.callback("🧠 Мышление", "mode_thinking")],
            [Markup.button.callback("🔍 Поиск", "mode_search")]
          ])
        });
      } catch (err) {
        console.error("Mode Error:", err);
      }
    });

    bot.action(/mode_(.*)/, async (ctx) => {
      try {
        const u = getInitUser(ctx);
        const newMode = ctx.match[1] as any;
        u.mode = newMode;
        saveDB();
        await ctx.answerCbQuery(`Режим: ${newMode}`).catch(()=>{});
        await ctx.editMessageText(`✅ Режим работы изменен на: <b>${newMode}</b>`, { parse_mode: "HTML" }).catch(()=>{});
      } catch (err) {
        console.error("Mode Action Error:", err);
      }
    });

    bot.command("referral", async (ctx) => {
      try {
        const u = getInitUser(ctx);
        const botUsername = ctx.botInfo?.username || "ТвойБот";
        const refLink = `https://t.me/${botUsername}?start=${u.id}`;
        
        await ctx.reply(
          `🔗 <b>Твоя реферальная программа</b>\n\n` +
          `Приглашено друзей: <b>${u.refCount}</b>\n\n` +
          `Отправь эту ссылку:\n${refLink}\n` + 
          `<i>Зарабатывай крутые бонусы.</i>`,
          { parse_mode: "HTML" }
        );
      } catch (err) {
         console.error("Referral Error:", err);
      }
    });

    bot.command("promo", async (ctx) => {
      try {
        const u = getInitUser(ctx);
        const text = (ctx.message as any)?.text || "";
        const parts = text.split(/\s+/).filter((p: string) => p.trim() !== "");
        if (parts.length < 2) return ctx.reply("❌ Введите промокод, например: /promo CODE");
        
        const code = parts.slice(1).join("").toUpperCase();
        if (code.includes("MAXVERSTAPPENBEST") || code.includes("KOSTASDEBIL")) {
           if (!u.isSubscribed) {
             u.isSubscribed = true;
             saveDB();
             await ctx.reply("✅ Промокод применен!\n\nВы получили БЕЗЛИМИТНЫЙ PRO статус: улучшенный ИИ, без ограничений по количеству сообщений.");
           } else {
             await ctx.reply("❕ Промокод уже был активирован, у вас уже есть PRO.");
           }
        } else {
           await ctx.reply(`❌ Промокод отклонён. Проверьте правильность ввода.`);
        }
      } catch (err) {
         console.error("Promo Error:", err);
      }
    });

    bot.command("buy", (ctx) => {
      ctx.replyWithInvoice({
        title: "Подписка PRO (1 месяц)",
        description: "Безлимитный доступ (150 рублей в месяц). Оплата Telegram Stars (пополняются картой или монетами TON).",
        payload: "sub_1_month",
        provider_token: "",
        currency: "XTR",
        prices: [{ label: "1 месяц", amount: 150 }]
      }).catch(e => console.error("Invoice Error:", e));
    });

    bot.on("pre_checkout_query", async (ctx) => {
      await ctx.answerPreCheckoutQuery(true).catch(console.error);
    });

    bot.on(message("successful_payment"), async (ctx) => {
      const u = getInitUser(ctx);
      u.isSubscribed = true;
      saveDB();
      await ctx.reply("🎉 Оплата успешна! Твой PRO доступ активирован на 1 месяц!");
    });

    bot.command("kostas", async (ctx) => {
      ctx.reply("671").catch(console.error);
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

    const handleInput = async (ctx: any, text: string) => {
      // In group chats, only respond if the bot is replied to or explicitly mentioned
      if (ctx.chat?.type !== 'private') {
         const botUsername = ctx.botInfo?.username;
         const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id;
         const isMentioned = botUsername && text && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
         if (!isReplyToBot && !isMentioned) {
             return;
         }
         // Remove the bot username mention from the text so it doesn't confuse the AI
         if (botUsername && text) {
             const mentionRegex = new RegExp(`@${botUsername}`, 'ig');
             text = text.replace(mentionRegex, '').trim();
         }
      }
      const u = getInitUser(ctx);

      const upperText = (text || "").toUpperCase();
      if (upperText.includes("MAXVERSTAPPENBEST") || upperText.includes("KOSTASDEBIL")) {
         if (!u.isSubscribed) {
           u.isSubscribed = true;
           saveDB();
           await ctx.reply("✅ Промокод применен!\n\nВы получили БЕЗЛИМИТНЫЙ PRO статус: генерация картинок, улучшенный ИИ, без ограничений по количеству сообщений.");
         } else {
           await ctx.reply("❕ Промокод уже был активирован, у вас уже есть PRO.");
         }
         return;
      }
      
      if (!checkLimit(u, u.mode)) {
        return ctx.reply("❌ Дневной лимит для этого режима исчерпан. Переключите режим или купите PRO: /buy");
      }

      if (!ai) return ctx.reply("ИИ отключен сервером.");
      ctx.sendChatAction("typing").catch(()=>{});

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

        const chat = u.chats[u.currentChatId];
        chat.history.push({ role: "user", parts });
        if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);

        let tools = undefined;
        let model = "gemini-3.1-flash-lite"; // By default, fast
        let sysInst = "Ты WolffAi, вежливый, уважительный и умный ИИ-помощник. Отвечай кратко и приветливо.";

        if (u.mode === "search") {
           model = "gemma-4-26b-a4b-it";
           tools = [{ googleSearch: {} }];
        } else if (u.mode === "thinking") {
           model = "gemini-3.5-flash";
           sysInst += " Глубоко продумывай и аргументируй ответ.";
        } else {
           if (!u.isSubscribed && (u.messagesFast || 0) > 20) {
              model = "gemma-4-26b-a4b-it"; // fallback for fast mode
           }
        }

        let replyText = "";
        try {
          const response = await ai.models.generateContent({
             model,
             contents: chat.history,
             config: { 
               systemInstruction: sysInst,
               tools: tools
             }
          });
          replyText = response.text || "Нет ответа.";
        } catch (genErr: any) {
           console.error("Gemini Generation Error:", genErr);
           let retrySuccess = false;
           if (genErr.message) {
               const msg = genErr.message.toLowerCase();
               if (msg.includes("limit") || msg.includes("429") || msg.includes("quota") || msg.includes("503") || msg.includes("unavailable") || msg.includes("demand")) {
                   console.log("Limit / 503 reached. Falling back to gemma-4-26b-a4b-it");
                   try {
                      const fallbackResponse = await ai.models.generateContent({
                         model: "gemma-4-26b-a4b-it",
                         contents: chat.history,
                         config: { systemInstruction: sysInst }
                      });
                      replyText = fallbackResponse.text || "Нет ответа.";
                      retrySuccess = true;
                   } catch (fallbackErr) {
                      console.error("Fallback failed:", fallbackErr);
                   }
               }
           }

           if (!retrySuccess) {
               chat.history.pop(); // Revert user query to not corrupt history
               let errorDesc = "❌ Произошла ошибка. Слишком сложный запрос, или данная функция не поддерживается в текущем режиме.";
               if (genErr.message) {
                   const msg = genErr.message.toLowerCase();
                   if (msg.includes("not found")) {
                       errorDesc = "❌ Выбранная ИИ-модель временно недоступна в этом режиме. Попробуйте сменить через /mode.";
                   } else if (msg.includes("limit") || msg.includes("429") || msg.includes("quota")) {
                       errorDesc = "❌ Вы исчерпали лимиты запросов у провайдера ИИ (Google API). Попробуйте позже или используйте другой тариф.";
                   } else if (msg.includes("503") || msg.includes("unavailable") || msg.includes("demand")) {
                       errorDesc = "❌ Выбранная модель перегружена (Google API 503). Пожалуйста, повторите запрос чуть позже.";
                   }
               }
               return ctx.reply(errorDesc);
           }
        }

        chat.history.push({ role: "model", parts: [{ text: replyText }] });
        saveDB();

        const footer = `\n\n---\n💎 Подключить PRO: /buy\n🔗 Реферальная программа: /referral`;
        await ctx.reply(replyText + footer, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
          await ctx.reply(replyText + "\n\n--- 💎 /buy | 🔗 /referral");
        });
      } catch (err: any) {
        console.error("General Handler Error:", err);
        ctx.reply("❌ Произошла системная ошибка. Попробуйте очистить контекст: /clear");
      }
    };

    bot.on("inline_query", async (ctx) => {
      const query = ctx.inlineQuery.query.trim();
      if (!query) {
        return ctx.answerInlineQuery([]);
      }

      try {
        const u = getInitUser(ctx);
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        
        let modelParams = {
            model: "gemini-3.1-flash-lite", // fastest
            contents: query,
            config: { 
               systemInstruction: "Ты WolffAi, быстрый и умный помощник. Отвечай максимально кратко для ответа в чате."
            }
        };

        const response = await ai.models.generateContent(modelParams as any);
        const replyText = response.text || "Нет ответа.";

        const result = [{
          type: "article",
          id: String(Date.now()),
          title: "WolffAi: ответить",
          description: replyText.substring(0, 80) + "...",
          input_message_content: {
            message_text: `<b>💬 Вопрос:</b> ${query}\n\n🤖 <b>WolffAi:</b>\n${replyText}`,
            parse_mode: "HTML"
          }
        }];

        await ctx.answerInlineQuery(result as any, { cache_time: 0 });
      } catch (e: any) {
        console.error("Inline query error:", e.message);
        await ctx.answerInlineQuery([]);
      }
    });

    bot.catch((err, ctx) => {
       console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    });

    bot.on(message("text"), (ctx) => handleInput(ctx, (ctx.message as any).text));
    bot.on(message("photo"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));

    const webhookDomain = process.env.WEBHOOK_DOMAIN;
    if (webhookDomain) {
      const webhookPath = `/telegraf/${botToken}`;
      app.use(bot.webhookCallback(webhookPath));
      bot.telegram.setWebhook(`${webhookDomain}${webhookPath}`)
        .then(() => console.log(`Bot started with Webhooks on ${webhookDomain}`))
        .catch(console.error);
    } else {
      bot.launch().then(() => console.log("Bot started with Long Polling")).catch(console.error);
    }

    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.log("TELEGRAM_BOT_TOKEN missing");
  }

  app.get("/api/health", (req, res) => {
    res.status(200).send("OK");
  });

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
