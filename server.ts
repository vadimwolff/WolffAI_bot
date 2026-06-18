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
          ctx.telegram.sendMessage(inviterId, `🎉 По вашей ссылке зарегистрировался: ${ctx.from.first_name}!`).catch(() => {});
          saveDB();
        }
      }

      ctx.reply(
        `👋 Привет, <b>${ctx.from.first_name}</b>! Я <b>WolffAi</b> — твой умный ИИ.\n\n` + 
        `Я надёжно изолирую и храню твои чаты, генерирую код, картинки и думаю над сложными задачами!\n\n` +
        `🛠 <b>Команды:</b>\n` +
        `• /mode — Режим работы (⚡Быстрый 🧠Мышление 💻Код 🔍Поиск)\n` +
        `• /image [текст] — Создать картинку\n` +
        `• /newchat [название] — Создать новый чат\n` +
        `• /chats — Список твоих чатов\n` +
        `• /clear — Очистить текущий чат\n` + 
        `• /buy — Безлимитный PRO\n` + 
        `• /promo [код] — Ввести промокод\n` +
        `• /referral — Пригласить друзей\n`,
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
            [Markup.button.callback("💻 Код", "mode_code"), Markup.button.callback("🔍 Поиск", "mode_search")]
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
             await ctx.reply("✅ Промокод применен!\n\nВы получили БЕЗЛИМИТНЫЙ PRO статус: генерация картинок, улучшенный ИИ, без ограничений по количеству сообщений.");
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
        title: "Подписка PRO",
        description: "Безлимитный доступ, генерация картинок, все режимы.",
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
      await ctx.reply("🎉 Оплата (Stars) успешна! Твой PRO доступ активирован навсегда!");
    });

    bot.command("image", async (ctx) => {
      const u = getInitUser(ctx);
      if (!checkLimit(u)) return ctx.reply("❌ Лимит исчерпан. Повторите попытку завтра или приобретите подписку: /buy");
      
      const text = (ctx.message as any)?.text || "";
      const prompt = text.replace("/image", "").trim();
      if (!prompt) return ctx.reply("Формат: /image [описание картинки]");
      
      if (!ai) return ctx.reply("ИИ отключен.");
      
      ctx.sendChatAction("upload_photo").catch(()=>{});
      try {
        const response = await ai.models.generateImages({
            model: 'imagen-3.0-generate-002',
            prompt: prompt,
            config: {
                numberOfImages: 1,
                aspectRatio: "1:1",
                outputMimeType: "image/jpeg"
            }
        });
        const base64Image = response.generatedImages?.[0]?.image?.imageBytes;
        if (base64Image) {
           await ctx.replyWithPhoto({ source: Buffer.from(base64Image, 'base64') }, {
              caption: `🖼 Сгенерировано для вас!\n\n💎 Купить PRO: /buy | 🔗 Рефералы: /referral`
           });
        } else {
           ctx.reply("❌ Не удалось сгенерировать изображение. Возможно, описание нарушает политику безопасности.");
        }
      } catch (err) {
        console.error("Image Error:", err);
        ctx.reply("❌ Ошибка при генерации картинки. Запрос отклонён политикой безопасности.");
      }
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
         const isMentioned = botUsername && text && text.includes(`@${botUsername}`);
         if (!isReplyToBot && !isMentioned) {
             return;
         }
         // Remove the bot username mention from the text so it doesn't confuse the AI
         if (botUsername && text) {
             text = text.replace(`@${botUsername}`, '').trim();
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
      
      if (!checkLimit(u)) {
        return ctx.reply("❌ Дневной лимит 10 сообщений исчерпан( Купите подписку командой /buy или введите /promo");
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
        let model = "gemini-2.5-flash";
        let sysInst = "Ты WolffAi, дерзкий, умный компаньон. Отвечай кратко.";

        if (u.mode === "thinking") {
            model = "gemini-2.5-pro";
            sysInst += " Глубоко продумывай и аргументируй ответ.";
        } else if (u.mode === "search") {
           tools = [{ googleSearch: {} }];
        } else if (u.mode === "code") {
           sysInst += " Приводи рабочий код и лучшие практики.";
        }

        try {
          const response = await ai.models.generateContent({
             model,
             contents: chat.history,
             config: { 
               systemInstruction: sysInst,
               tools: tools
             }
          });

          const replyText = response.text || "Нет ответа.";
          
          chat.history.push({ role: "model", parts: [{ text: replyText }] });
          saveDB();

          const footer = `\n\n---\n💎 Подключить PRO: /buy\n🔗 Реферальная программа: /referral`;
          await ctx.reply(replyText + footer, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
            await ctx.reply(replyText + "\n\n--- 💎 /buy | 🔗 /referral");
          });
        } catch (genErr: any) {
           console.error("Gemini Generation Error:", genErr);
           chat.history.pop(); // Revert user query to not corrupt history
           // Attempt a fallback if the selected model failed
           if (genErr.message && genErr.message.toLowerCase().includes("not found")) {
               return ctx.reply(`❌ Выбранная ИИ-модель временно недоступна в этом режиме. Попробуйте сменить через /mode.`);
           }
           ctx.reply("❌ Произошла ошибка. Слишком сложный запрос, или данная функция не поддерживается в текущем режиме.");
        }
      } catch (err: any) {
        console.error("General Handler Error:", err);
        ctx.reply("❌ Произошла системная ошибка. Попробуйте очистить контекст: /clear");
      }
    };

    bot.catch((err, ctx) => {
       console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
    });

    bot.on(message("text"), (ctx) => handleInput(ctx, (ctx.message as any).text));
    bot.on(message("photo"), (ctx) => handleInput(ctx, (ctx.message as any).caption || ""));

    bot.launch().then(() => console.log("Bot started")).catch(console.error);

    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.log("TELEGRAM_BOT_TOKEN missing");
  }

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
