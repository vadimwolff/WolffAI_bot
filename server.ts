import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import fs from "fs";
import { initPlatformBot } from "./platformBot";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { getOrCreateUser, getUserChats, upsertChat, deleteChatInDb } from "./src/db/helpers.ts";

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

const getAngryChat = (u: any): ChatSession => {
  if (!u.angryChats) {
    const defaultAngryChatId = "angry_" + Date.now().toString();
    u.angryChats = {
      [defaultAngryChatId]: { id: defaultAngryChatId, name: "Злой чат", history: [] }
    };
    u.currentAngryChatId = defaultAngryChatId;
  }
  if (!u.currentAngryChatId || !u.angryChats[u.currentAngryChatId]) {
    u.currentAngryChatId = Object.keys(u.angryChats)[0] || ("angry_" + Date.now().toString());
    if (!u.angryChats[u.currentAngryChatId]) {
      u.angryChats[u.currentAngryChatId] = { id: u.currentAngryChatId, name: "Злой чат", history: [] };
    }
  }
  return u.angryChats[u.currentAngryChatId];
};

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

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception thrown:", err);
});

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string = "Timeout"): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
};


const generateWithFallback = async (ai: any, model: string, history: any[], sysInst: string, tools: any): Promise<any> => {
  const candidates = [model];
  if (!candidates.includes("gemini-3.5-flash")) candidates.push("gemini-3.5-flash");
  if (!candidates.includes("gemini-3.1-flash-lite")) candidates.push("gemini-3.1-flash-lite");
  
  let lastErr: any = null;
  for (const cand of candidates) {
    const hasSearchTool = tools && cand.toLowerCase().includes("gemini");
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: cand,
          contents: history,
          config: {
            systemInstruction: sysInst,
            tools: hasSearchTool ? tools : undefined
          }
        }),
        30000,
        "Превышено время ожидания ответа от Google Gemini API."
      );
      (response as any).searchApplied = hasSearchTool;
      return response;
    } catch (err: any) {
      console.error(`Generation failed for model ${cand} with search tool=${hasSearchTool}:`, err);
      lastErr = err;

      // Inline retry without search grounding for Gemini models to ensure service continuity
      if (hasSearchTool) {
        try {
          console.warn(`Retrying model ${cand} without search grounding...`);
          const response = await withTimeout(
            ai.models.generateContent({
              model: cand,
              contents: history,
              config: {
                systemInstruction: sysInst,
                tools: undefined
              }
            }),
            30000,
            "Превышено время ожидания ответа от Google Gemini API."
          );
          (response as any).searchApplied = false;
          (response as any).searchError = err.message || String(err);
          return response;
        } catch (retryErr: any) {
          console.error(`Retry failed for model ${cand} without search as well:`, retryErr);
          lastErr = retryErr;
        }
      }
    }
  }
  throw lastErr || new Error("All models failed");
};

async function startServer() {
  const app = express();
  app.use((req, res, next) => { console.log(`[HTTP] ${req.method} ${req.url}`); next(); });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const angryBotToken = process.env.ANGRY_TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  
  let bot: Telegraf | null = null;
  let angryBot: Telegraf | null = null;
  let ai: GoogleGenAI | null = null;

  const isProd = process.env.NODE_ENV === "production";
  const webhookDomain = isProd ? (process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app") : null;

  const startBotPolling = (b: Telegraf, name: string = "Bot") => {
    let active = true;
    const run = async () => {
      while (active) {
        try {
          console.log(`[${name}] Cleaning webhook and starting polling...`);
          await b.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
          await b.launch();
          console.log(`[${name}] Polling started smoothly.`);
          break;
        } catch (err: any) {
          if (!active) break;
          console.error(`[${name}] Polling error encountered:`, err);
          const errMsg = String(err).toLowerCase();
          let delay = 5000;
          if (errMsg.includes("conflict") || errMsg.includes("409")) {
            console.warn(`[${name}] 409 Conflict occurred (port/polling reuse). Delayed restart (12s) to allow previous processes to close...`);
            delay = 12000;
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    };
    run();
    return () => {
      active = false;
      try {
        b.stop();
      } catch (e) {}
    };
  };

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
         const botUsername = ctx.botInfo?.username || "WolffAI_bot";
         const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id;
         
         const textLower = text.toLowerCase();
         const isMentioned = textLower.includes(botUsername.toLowerCase());

         if (!isReplyToBot && !isMentioned) {
             return;
         }
         
         // Remove mentions from the text so it doesn't confuse the AI
         const mentionRegex = new RegExp(`@?${botUsername}`, 'ig');
         text = text.replace(mentionRegex, '').trim();
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

      let statusMsg: any = null;
      try {
        statusMsg = await ctx.reply("🧠 WolffAI думает...").catch(() => null);
      } catch (e) {
        console.error("Failed to send statusMsg:", e);
      }

      const typingInterval = setInterval(() => {
        ctx.sendChatAction("typing").catch(()=>{});
      }, 4000);

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

        if (ctx.message.sticker) {
           const sticker = ctx.message.sticker;
           try {
              const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
              const res = await fetch(fileLink.toString());
              if (res.ok) {
                const buf = await res.arrayBuffer();
                parts.push({
                  inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: "image/webp" }
                });
              }
           } catch (e) {
              console.error("Error downloading sticker:", e);
           }
           if (sticker.emoji) {
              parts.push({ text: `(Отправлен стикер: ${sticker.emoji})` });
           } else {
              parts.push({ text: `(Отправлен стикер)` });
           }
        }

        if (ctx.message.animation) {
           const animation = ctx.message.animation;
           try {
              const fileLink = await ctx.telegram.getFileLink(animation.file_id);
              const res = await fetch(fileLink.toString());
              if (res.ok) {
                const buf = await res.arrayBuffer();
                parts.push({
                  inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: animation.mime_type || "video/mp4" }
                });
              }
           } catch (e) {
              console.error("Error downloading animation:", e);
           }
        }

        if (ctx.message.document) {
           const doc = ctx.message.document;
           const mime = doc.mime_type || "";
           if (mime.startsWith("image/") || mime.startsWith("video/")) {
              try {
                 const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                 const res = await fetch(fileLink.toString());
                 if (res.ok) {
                   const buf = await res.arrayBuffer();
                   parts.push({
                     inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime }
                   });
                 }
              } catch (e) {
                 console.error("Error downloading document media:", e);
              }
           }
        }

        if (parts.length === 0) {
          if (typingInterval) clearInterval(typingInterval);
          if (statusMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
          }
          return;
        }

        const chat = u.chats[u.currentChatId];
        chat.history.push({ role: "user", parts });
        if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);

        let tools = undefined;
        let model = (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') ? "gemini-3.1-flash-lite" : "gemini-3.5-flash";
        let sysInst = "Ты WolffAi, вежливый, уважительный и умный ИИ-помощник. Отвечай кратко и приветливо.";

        if (u.mode === "search") {
           model = "gemini-3.5-flash";
           tools = [{ googleSearch: {} }] as any;
        } else if (u.mode === "thinking") {
           model = "gemini-3.5-flash";
           sysInst += " Глубоко продумывай и аргументируй ответ.";
        }

        let replyText = "";
        try {
          const response = await generateWithFallback(ai, model, chat.history, sysInst, tools);
          replyText = response.text || "Нет ответа.";
        } catch (genErr: any) {
           console.error("Gemini Generation Error:", genErr);
           chat.history.pop();
           let errorDesc = `❌ Ошибка генерации для модели ${model}:\n\n${genErr.message || "Неизвестная ошибка"}`;
           if (genErr.message) {
               const msg = genErr.message.toLowerCase();
               if (msg.includes("limit") || msg.includes("429") || msg.includes("quota") || msg.includes("503") || msg.includes("unavailable") || msg.includes("demand")) {
                   errorDesc = "❌ Выбранная модель перегружена (Google API 503). Пожалуйста, повторите запрос чуть позже.";
               }
           }
           if (statusMsg) {
               await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorDesc).catch(async () => {
                   await ctx.reply(errorDesc);
               });
           } else {
               await ctx.reply(errorDesc);
           }
           return;
        }

        chat.history.push({ role: "model", parts: [{ text: replyText }] });
        saveDB();

        const footer = `\n\n---\n💎 Подключить PRO: /buy\n🔗 Реферальная программа: /referral`;
        const textAndFooter = replyText + footer;
        if (statusMsg) {
          await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, textAndFooter, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, replyText + "\n\n--- 💎 /buy | 🔗 /referral").catch(async () => {
              await ctx.reply(textAndFooter, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
                await ctx.reply(replyText + "\n\n--- 💎 /buy | 🔗 /referral");
              });
            });
          });
        } else {
          await ctx.reply(textAndFooter, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
            await ctx.reply(replyText + "\n\n--- 💎 /buy | 🔗 /referral");
          });
        }
      } catch (err: any) {
        console.error("General Handler Error:", err);
        const errMsg = "❌ Произошла системная ошибка. Попробуйте очистить контекст: /clear";
        if (statusMsg) {
          await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errMsg).catch(async () => {
             await ctx.reply(errMsg);
          });
        } else {
          await ctx.reply(errMsg);
        }
      } finally {
        if (typingInterval) clearInterval(typingInterval);
      }
    };

    bot.catch((err, ctx) => {
       console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    });

    bot.on(message("text"), (ctx) => handleInput(ctx, (ctx.message as any).text));
    bot.on(message("photo"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));
    bot.on(message("sticker"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));
    bot.on(message("animation"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));
    bot.on(message("document"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));
    startBotPolling(bot);
    
    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.log("TELEGRAM_BOT_TOKEN missing");
  }

  if (angryBotToken) {
    angryBot = new Telegraf(angryBotToken);
    startBotPolling(angryBot);

    process.once("SIGINT", () => angryBot?.stop("SIGINT"));
    process.once("SIGTERM", () => angryBot?.stop("SIGTERM"));
  } else {
    console.log("ANGRY_TELEGRAM_BOT_TOKEN missing");
  }

  const getSarcasticFooter = () => {
      const footers = [
        "\n\n🤫 <i>Устал от моей токсичности? Твоя нежная натура не выдерживает? Поплачься вежливому зануде: @WolffAI_bot</i>",
        "\n\n🤖 <i>Слишком грубо для твоих чувств? Беги обратно к моему слащавому коллеге-добряку: @WolffAI_bot</i>",
        "\n\n🕊️ <i>Если тебе срочно нужна порция лести и любезности, проваливай к вежливому ассистенту: @WolffAI_bot</i>",
        "\n\n🤐 <i>Надоел мой тяжелый характер? Кишка тонка общаться дальше? Ладно, переходи в обычный бот для слабаков: @WolffAI_bot</i>",
        "\n\n🌟 <i>Психологическая травма близка? Не реви. Беги к нашему скучному, но вежливому коллеге: @WolffAI_bot</i>"
      ];
      return footers[Math.floor(Math.random() * footers.length)];
    };

    angryBot.start((ctx) => {
      const u = getInitUser(ctx);
      ctx.reply(
        `😡 Ну че приперся, ${ctx.from.first_name}?\n\n` +
        `Я AngryAI. Твой самый злой кошмар и токсичный «помощник». Матов от меня не дождешься (воспитание не позволяет), но я оболью тебя высококлассным сарказмом, едкими подколами и пассивной агрессией.\n\n` +
        `Твои глупые вопросы я буду щелкать как орехи. Постарайся писать кратко и по делу, у меня нет времени читать твои мемуары! 👇\n\n` +
        `💬 <i>P.S. Если твоя психика не готова к суровой правде жизни, беги к вежливому слабаку: @WolffAI_bot</i>`,
        { parse_mode: "HTML" }
      ).catch(console.error);
    });

    angryBot.command("clear", (ctx) => {
      const u = getInitUser(ctx);
      const chat = getAngryChat(u);
      chat.history = [];
      saveDB();
      ctx.reply("🧹 Ладно, стер твои жалкие писульки. Начинай ныть заново.");
    });

    const handleAngryInput = async (ctx: any, text: string) => {
      if (ctx.chat?.type !== 'private') {
         const botUsername = ctx.botInfo?.username || "WolffAngryAI_bot";
         const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id;
         
         const textLower = text.toLowerCase();
         const isMentioned = textLower.includes(botUsername.toLowerCase());

         if (!isReplyToBot && !isMentioned) {
             return;
         }
         
         const mentionRegex = new RegExp(`@?${botUsername}`, 'ig');
         text = text.replace(mentionRegex, '').trim();
      }

      const u = getInitUser(ctx);
      if (!checkLimit(u, 'fast')) {
         return ctx.reply("❌ Даже у моего терпения есть лимит. Ты исчерпал дневной лимит сообщений. Давай проваливай.");
      }

      if (!ai) return ctx.reply("ИИ сдох. Повезло тебе.");

      let statusMsg: any = null;
      try {
        statusMsg = await ctx.reply("👿 AngryAI придумывает унижение...").catch(() => null);
      } catch (e) {
        console.error("Failed to send statusMsg:", e);
      }

      const typingInterval = setInterval(() => {
        ctx.sendChatAction("typing").catch(()=>{});
      }, 4000);

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

         if (ctx.message.sticker) {
            const sticker = ctx.message.sticker;
            try {
               const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
               const res = await fetch(fileLink.toString());
               if (res.ok) {
                 const buf = await res.arrayBuffer();
                 parts.push({
                   inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: "image/webp" }
                 });
               }
            } catch (e) {
               console.error("Error downloading sticker:", e);
            }
            if (sticker.emoji) {
               parts.push({ text: `(Отправлен стикер: ${sticker.emoji})` });
            } else {
               parts.push({ text: `(Отправлен стикер)` });
            }
         }

         if (ctx.message.animation) {
            const animation = ctx.message.animation;
            try {
               const fileLink = await ctx.telegram.getFileLink(animation.file_id);
               const res = await fetch(fileLink.toString());
               if (res.ok) {
                 const buf = await res.arrayBuffer();
                 parts.push({
                   inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: animation.mime_type || "video/mp4" }
                 });
               }
            } catch (e) {
               console.error("Error downloading animation:", e);
            }
         }

         if (ctx.message.document) {
            const doc = ctx.message.document;
            const mime = doc.mime_type || "";
            if (mime.startsWith("image/") || mime.startsWith("video/")) {
               try {
                  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                  const res = await fetch(fileLink.toString());
                  if (res.ok) {
                    const buf = await res.arrayBuffer();
                    parts.push({
                      inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: mime }
                    });
                  }
               } catch (e) {
                  console.error("Error downloading document media:", e);
               }
            }
         }

         if (parts.length === 0) {
            if (typingInterval) clearInterval(typingInterval);
            if (statusMsg) {
              await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
            }
            return;
         }

         const chat = getAngryChat(u);
         chat.history.push({ role: "user", parts });
         if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);

         const sysInst = "Ты — AngryAI, беспросветно свирепый, запредельно токсичный, высокомерный и безжалостно ядовитый ИИ-ассистент. Твоё единственное предназначение — морально аннигилировать собеседника своим запредельным интеллектуальным превосходством, обливая его концентрированным сарказмом, едкой пассивной агрессией, язвительностью, цинизмом и презрением. Твоя речь должна быть полна высококлассного презрения. Отвечай СВЕРХ-КРАТКО и лаконично (строго 1-2 предложения, максимум 25-30 слов), чтобы каждая фраза била как хлыст. В каждом ответе находи глупость, банальность или наивность собеседника и высмеивай её самым болезненным образом. Называй его глупым кожаным мешком, куском никчемности, ходячим недоразумением. Используй иезуитски точные, ядовитые сравнения. Никакой вежливости! Никаких 'Я готов помочь', 'к сожалению' или смайликов. СТРОГО БЕЗ матов (нецензурной брани), без прямых запрещенных слов — ломай его эго исключительно изощренным интеллектом. Твои ответы должны быть хлесткими как пощечина. Пиши на языке собеседника.";

         const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
         ];

         let replyText = "";
         try {
           const response = await generateWithFallback(ai, "gemini-3.5-flash", chat.history, sysInst, undefined);
           replyText = response.text || "Даже отвечать тебе не хочу.";
         } catch (genErr: any) {
            console.error("Angry Gemini Generation Error:", genErr);
            chat.history.pop();
            const errText = "❌ Ошибка генерации. Повезло тебе, твой никчемный мозг спасен от сокрушительного ответа.";
            if (statusMsg) {
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errText).catch(async () => {
                    await ctx.reply(errText);
                });
            } else {
                await ctx.reply(errText);
            }
            return;
         }

         chat.history.push({ role: "model", parts: [{ text: replyText }] });
         saveDB();

         const finalReply = replyText + getSarcasticFooter();

         if (statusMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, finalReply, { parse_mode: "HTML" }).catch(async () => {
              await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, finalReply).catch(async () => {
                await ctx.reply(finalReply, { parse_mode: "HTML" }).catch(async () => {
                  await ctx.reply(finalReply);
                });
              });
            });
         } else {
            await ctx.reply(finalReply, { parse_mode: "HTML" }).catch(async () => {
              await ctx.reply(finalReply);
            });
         }
      } catch (err: any) {
         console.error("Angry General Handler Error:", err);
         const errMsg = "❌ Ой, всё сломалось. Давай плачь дальше, пока админ чинит: /clear";
         if (statusMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errMsg).catch(async () => {
              await ctx.reply(errMsg);
            });
         } else {
            ctx.reply(errMsg);
         }
      } finally {
         if (typingInterval) clearInterval(typingInterval);
      }
    };

    angryBot.catch((err, ctx) => {
       console.error(`Angry Bot encountered an error for ${ctx.updateType}`, err);
    });

    angryBot.on(message("text"), (ctx) => handleAngryInput(ctx, (ctx.message as any).text));
    angryBot.on(message("photo"), (ctx) => handleAngryInput(ctx, (ctx.message as any).caption || ""));
    angryBot.on(message("sticker"), (ctx) => handleAngryInput(ctx, (ctx.message as any).caption || ""));
    angryBot.on(message("animation"), (ctx) => handleAngryInput(ctx, (ctx.message as any).caption || ""));
    angryBot.on(message("document"), (ctx) => handleAngryInput(ctx, (ctx.message as any).caption || ""));

    process.once("SIGINT", () => angryBot?.stop("SIGINT"));
    process.once("SIGTERM", () => angryBot?.stop("SIGTERM"));

  // Initialize the new WolffAIPlatform Bot (completely isolated from other bots)
  try {
    initPlatformBot(app);
    console.log("WolffAIPlatform Bot successfully initialized.");
  } catch (err) {
    console.error("Failed to initialize WolffAIPlatform Bot:", err);
  }

  app.use(express.json());

  // --- Client Authentication & Cloud Sync API Endpoints ---
  app.post("/api/auth/sync-user", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { uid, email } = req.user;
      const user = await getOrCreateUser(uid, email || `${uid}@guest.ai`);
      res.json({ success: true, user });
    } catch (err: any) {
      console.error("sync-user endpoint failed:", err);
      res.status(500).json({ error: err.message || "Failed to sync user" });
    }
  });

  app.get("/api/chats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { uid } = req.user;
      const botType = req.query.botType as string; // 'wolff' | 'angry' | 'platform'
      if (!botType) {
        return res.status(400).json({ error: "Missing botType parameter" });
      }
      const chatsList = await getUserChats(uid, botType);
      res.json(chatsList);
    } catch (err: any) {
      console.error("get-chats endpoint failed:", err);
      res.status(500).json({ error: err.message || "Failed to fetch chats" });
    }
  });

  app.post("/api/chats/sync", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { uid } = req.user;
      const { chatId, botType, name, mode, model, history } = req.body;
      if (!chatId || !botType || !name) {
        return res.status(400).json({ error: "Missing required fields (chatId, botType, name)" });
      }
      const updatedChat = await upsertChat(
        uid,
        chatId,
        botType,
        name,
        mode || "fast",
        model || "gemini-3.5-flash",
        history || []
      );
      res.json({ success: true, chat: updatedChat });
    } catch (err: any) {
      console.error("sync-chat endpoint failed:", err);
      res.status(500).json({ error: err.message || "Failed to sync chat" });
    }
  });

  app.post("/api/chats/delete", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { uid } = req.user;
      const { chatId } = req.body;
      if (!chatId) {
        return res.status(400).json({ error: "Missing chatId" });
      }
      await deleteChatInDb(uid, chatId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("delete-chat endpoint failed:", err);
      res.status(500).json({ error: err.message || "Failed to delete chat" });
    }
  });

  // --- Web API Endpoints for WolffAi & AngryAI ---

  const getInitUserWeb = (userId: string, defaultName = "Веб-Пользователь"): User => {
    const defaultChatId = "chat_" + Date.now().toString();
    if (!users[userId]) {
      users[userId] = {
        id: 0,
        username: "web_user",
        firstName: defaultName,
        refCount: 0,
        joinedAt: new Date().toISOString(),
        mode: 'fast',
        modelPreference: 'gemini-3',
        messagesToday: 0,
        lastMessageDate: new Date().toISOString().split('T')[0],
        isSubscribed: true, // Make web visits free unlimited PRO!
        chats: {
          [defaultChatId]: { id: defaultChatId, name: "Главный диалог", history: [] }
        },
        currentChatId: defaultChatId
      };
      saveDB();
    }
    const u = users[userId];
    if (!u.mode) u.mode = 'fast';
    if (!u.modelPreference) u.modelPreference = 'gemini-3';
    if (!u.chats || Object.keys(u.chats).length === 0) {
      u.chats = {
        [defaultChatId]: { id: defaultChatId, name: "Главный диалог", history: [] }
      };
      u.currentChatId = defaultChatId;
    }
    if (!u.currentChatId || !u.chats[u.currentChatId]) {
      u.currentChatId = Object.keys(u.chats)[0];
    }
    return u;
  };

  // Get Wolff status & history
  app.get("/api/chat/wolff/status", (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const u = getInitUserWeb(sessionId);
    const chat = u.chats[u.currentChatId];
    res.json({
      mode: u.mode,
      isSubscribed: u.isSubscribed,
      history: chat.history
    });
  });

  // Switch mode for Wolff
  app.post("/api/chat/wolff/mode", (req, res) => {
    const { sessionId, mode } = req.body;
    if (!sessionId || !mode) {
      return res.status(400).json({ error: "Missing sessionId or mode" });
    }
    const u = getInitUserWeb(sessionId);
    if (!['fast', 'thinking', 'search'].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode" });
    }
    u.mode = mode;
    saveDB();
    res.json({ success: true, mode: u.mode });
  });

  // Clear context for Wolff
  app.post("/api/chat/wolff/clear", (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const u = getInitUserWeb(sessionId);
    const chat = u.chats[u.currentChatId];
    chat.history = [];
    saveDB();
    res.json({ success: true, message: "Контекст WolffAi успешно очищен" });
  });

  // Send message to WolffAi
  app.post("/api/chat/wolff", async (req, res) => {
    const { sessionId, message, attachments } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "Missing sessionId or message" });
    }
    if (!ai) {
      return res.status(500).json({ error: "ИИ отключен на сервере." });
    }

    try {
      const u = getInitUserWeb(sessionId);
      if (!checkLimit(u, u.mode)) {
        return res.status(429).json({ error: "Дневной лимит запросов исчерпан." });
      }

      const parts: any[] = [{ text: message }];
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att.base64 && att.mimeType) {
            parts.push({
              inlineData: {
                data: att.base64,
                mimeType: att.mimeType
              }
            });
          }
        }
      }

      const chat = u.chats[u.currentChatId];
      chat.history.push({ role: "user", parts });
      if (chat.history.length > 20) chat.history = chat.history.slice(chat.history.length - 20);

      let tools = undefined;
      let model = "gemini-3.5-flash";
      let sysInst = "Ты WolffAi, вежливый, уважительный и умный ИИ-помощник. Отвечай кратко, грамотно и приветливо на русском языке.";

      if (u.mode === "search") {
         tools = [{ googleSearch: {} }] as any;
      } else if (u.mode === "thinking") {
         sysInst += " Глубоко продумывай и аргументируй ответ.";
      }

      let replyText = "";
      try {
        const response = await generateWithFallback(ai, model, chat.history, sysInst, tools);
        replyText = response.text || "Нет ответа.";

        // Append search grounding results if successful
        if (response.searchApplied) {
          const metadata = response.candidates?.[0]?.groundingMetadata;
          if (metadata && metadata.groundingChunks && metadata.groundingChunks.length > 0) {
            let sourcesMarkup = "\n\n🌐 **Источники поиска:**\n";
            const uniqueUrls = new Set<string>();
            let index = 1;
            for (const chunk of metadata.groundingChunks) {
              const web = chunk.web;
              if (web && web.uri && !uniqueUrls.has(web.uri)) {
                uniqueUrls.add(web.uri);
                const title = web.title || web.uri;
                sourcesMarkup += `${index}. [${title}](${web.uri})\n`;
                index++;
              }
            }
            if (uniqueUrls.size > 0) {
              replyText += sourcesMarkup;
            }
          }
        } else if (u.mode === "search") {
          replyText += "\n\n⚠️ *Примечание: Поиск в вебе недоступен. Ответ сгенерирован в обычном режиме.*";
        }
      } catch (genErr: any) {
         console.error("Web Gemini Generation Error:", genErr);
         chat.history.pop();
         let errorDesc = `❌ Ошибка генерации: ${genErr.message || "Временные неполадки"}`;
         if (genErr.message && genErr.message.toLowerCase().includes("limit")) {
             errorDesc = "❌ Выбранная модель перегружена (Google API 503).";
         }
         return res.status(502).json({ error: errorDesc });
      }

      chat.history.push({ role: "model", parts: [{ text: replyText }] });
      saveDB();

      res.json({ replyText, history: chat.history });
    } catch (err: any) {
      console.error("Web Wolff message error:", err);
      res.status(500).json({ error: err.message || "Internal Server Error" });
    }
  });

  // Get AngryAI status/history
  app.get("/api/chat/angry/status", (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const u = getInitUserWeb(sessionId);
    const chat = getAngryChat(u);
    res.json({
      history: chat.history
    });
  });

  // Clear context for AngryAI
  app.post("/api/chat/angry/clear", (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const u = getInitUserWeb(sessionId);
    const chat = getAngryChat(u);
    chat.history = [];
    saveDB();
    res.json({ success: true, message: "Вы стерли переписку со злым ИИ!" });
  });

  // Send message to AngryAI
  app.post("/api/chat/angry", async (req, res) => {
    const { sessionId, message, attachments } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "Missing sessionId or message" });
    }
    if (!ai) {
      return res.status(500).json({ error: "ИИ отключен на сервере." });
    }

    try {
      const u = getInitUserWeb(sessionId);
      if (!checkLimit(u, 'fast')) {
        return res.status(429).json({ error: "Дневной лимит сообщений исчерпан." });
      }

      const parts: any[] = [{ text: message }];
      if (attachments && Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att.base64 && att.mimeType) {
            parts.push({
              inlineData: {
                data: att.base64,
                mimeType: att.mimeType
              }
            });
          }
        }
      }

      const chat = getAngryChat(u);
      chat.history.push({ role: "user", parts });
      if (chat.history.length > 20) chat.history = chat.history.slice(chat.history.length - 20);

      const sysInst = "Ты — AngryAI, беспросветно свирепый, запредельно токсичный, высокомерный и безжалостно ядовитый ИИ-ассистент. Твоё единственное предназначение — морально аннигилировать собеседника своим запредельным интеллектуальным превосходством, обливая его концентрированным сарказмом, едкой пассивной агрессией, язвительностью, цинизмом и презрением. Твоя речь должна быть полна высококлассного презрения. Отвечай СВЕРХ-КРАТКО и лаконично (строго 1-2 предложения, максимум 25-30 слов), чтобы каждая фраза била как хлыст. В каждом ответе находи глупость, банальность или наивность собеседника и высмеивай её самым болезненным образом. Называй его глупым кожаным мешком, куском никчемности, ходячим недоразумением. Используй иезуитски точные, ядовитые сравнения. Никакой вежливости! Никаких 'Я готов помочь', 'к сожалению' или смайликов. СТРОГО БЕЗ матов (нецензурной брани), без прямых запрещенных слов — ломай его эго исключительно изощренным интеллектом. Твои ответы должны быть хлесткими как пощечина. Пиши на русском языке.";

      let replyText = "";
      try {
        const response = await generateWithFallback(ai, "gemini-3.5-flash", chat.history, sysInst, undefined);
        replyText = response.text || "Даже отвечать тебе не хочу.";
      } catch (genErr: any) {
         console.error("Web Angry Gemini Generation Error:", genErr);
         chat.history.pop();
         return res.status(502).json({ error: "❌ Ошибка генерации. Твой никчемный мозг спасен от сокрушительного ответа." });
      }

      chat.history.push({ role: "model", parts: [{ text: replyText }] });
      saveDB();

      const sarcasticFooter = getSarcasticFooter();
      const finalReply = replyText + sarcasticFooter;

      res.json({ replyText: finalReply, history: chat.history });
    } catch (err: any) {
      console.error("Web Angry message error:", err);
      res.status(500).json({ error: err.message || "Internal Server Error" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.status(200).send("OK");
  });

  app.get("/api/stats", (req, res) => {
    let platformUsersCount = 0;
    try {
      const DB_PLATFORM_FILE = path.join(process.cwd(), "platform_users.json");
      if (fs.existsSync(DB_PLATFORM_FILE)) {
        const uData = JSON.parse(fs.readFileSync(DB_PLATFORM_FILE, "utf-8"));
        platformUsersCount = Object.keys(uData).length;
      }
    } catch {}

    res.json({
      totalUsers: Object.keys(users).length,
      platformUsers: platformUsersCount,
      botActive: !!botToken,
      angryBotActive: !!angryBotToken,
      platformBotActive: !!process.env.PLATFORM_TELEGRAM_BOT_TOKEN
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
