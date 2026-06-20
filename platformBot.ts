import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string = "Timeout"): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
};

const geminiApiKey = process.env.GEMINI_API_KEY;
const aiClient = geminiApiKey ? new GoogleGenAI({
  apiKey: geminiApiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
}) : null;

function historyToGeminiContents(history: Array<{ role: 'user' | 'assistant'; content: any }>) {
  return history.map(turn => {
    const role = turn.role === 'assistant' ? 'model' : 'user';
    let parts: any[] = [];
    
    if (typeof turn.content === 'string') {
      parts.push({ text: turn.content });
    } else if (Array.isArray(turn.content)) {
      for (const item of turn.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url' && item.image_url?.url) {
          const urlStr = item.image_url.url;
          const match = urlStr.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          } else {
            parts.push({ text: `[Image: ${urlStr.slice(0, 50)}...]` });
          }
        }
      }
    } else {
      parts.push({ text: String(turn.content || "") });
    }
    
    return { role, parts };
  });
}

interface PlatformChatSession {
  id: string;
  name: string;
  history: Array<{ role: 'user' | 'assistant'; content: any }>;
}

interface PlatformUser {
  id: number;
  username?: string;
  firstName?: string;
  joinedAt: string;
  activeModel: string;
  chats: Record<string, PlatformChatSession>;
  currentChatId: string;
  messagesToday: number;
  lastMessageDate: string;
  isSubscribed: boolean;
  modelMessagesToday?: Record<string, number>;
}

const DB_PLATFORM_FILE = path.join(process.cwd(), "platform_users.json");

let platformUsers: Record<string, PlatformUser> = {};

if (fs.existsSync(DB_PLATFORM_FILE)) {
  try {
    const data = fs.readFileSync(DB_PLATFORM_FILE, "utf-8");
    platformUsers = JSON.parse(data);
  } catch (e) {
    console.error("Error reading platform_users.json:", e);
  }
}

const savePlatformDB = () => {
  try {
    fs.writeFileSync(DB_PLATFORM_FILE, JSON.stringify(platformUsers, null, 2));
  } catch (err) {
    console.error("Error writing platform_users.json:", err);
  }
};

const MODELS_INFO = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", desc: "Ультрабыстрый мультимодальный флагман через Google Gemini API.", multimodal: true },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B (free)", desc: "Открытая мультимодальная модель от Google DeepMind.", multimodal: true },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (free)", desc: "Флагманская модель Meta.", multimodal: false },
  { id: "nousresearch/hermes-3-llama-3.1-405b:free", name: "Hermes 3 405B", desc: "Огромная модель 405B от Nous Research для сложных рассуждений.", multimodal: false },
  { id: "openrouter/owl-alpha", name: "Owl Alpha (free)", desc: "Высокопроизводительная модель OpenRouter для агентов.", multimodal: false },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra", desc: "Флагман NVIDIA (550B MoE).", multimodal: false },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 Omni", desc: "Мультимодальная модель от NVIDIA.", multimodal: true },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super", desc: "Модель NVIDIA (120B).", multimodal: false },
  { id: "nex-agi/nex-n2-pro:free", name: "Nex-N2-Pro", desc: "Агентная MoE модель Nex AGI.", multimodal: false },
  { id: "openai/gpt-oss-120b:free", name: "gpt-oss-120b (free)", desc: "Открытая MoE модель на 120B параметров.", multimodal: false },
  { id: "openai/gpt-oss-20b:free", name: "gpt-oss-20b (free)", desc: "Открытая модель на 20B параметров от OpenAI.", multimodal: false },
  { id: "poolside/laguna-m.1:free", name: "Laguna M.1", desc: "Кодинговый агент от Poolside.", multimodal: false },
  { id: "poolside/laguna-xs.2:free", name: "Laguna XS.2", desc: "Второе поколение кодинговой модели от Poolside.", multimodal: false },
  { id: "qwen/qwen3-coder:free", name: "Qwen3 Coder", desc: "Моделирование кода Qwen (480B).", multimodal: false },
  { id: "liquid/lfm-2.5-1.2b-thinking:free", name: "LFM2.5 Thinking", desc: "Легкая модель для рассуждений от Liquid.", multimodal: false },
  { id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", name: "Uncensored Dolphin", desc: "Без цензуры (Dolphin Mistral 24B).", multimodal: false }
];

const getInitPlatformUser = (ctx: any): PlatformUser => {
  const userId = ctx.from.id;
  const defaultChatId = Date.now().toString();
  
  if (!platformUsers[userId]) {
    platformUsers[userId] = {
      id: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      joinedAt: new Date().toISOString(),
      activeModel: "gemini-3.1-flash-lite", // Default to lightweight
      chats: {
        [defaultChatId]: { id: defaultChatId, name: "Главный диалог", history: [] }
      },
      currentChatId: defaultChatId,
      messagesToday: 0,
      lastMessageDate: new Date().toISOString().split('T')[0],
      isSubscribed: false
    };
    savePlatformDB();
  }
  
  const u = platformUsers[userId];
  const modelExists = MODELS_INFO.some(m => m.id === u.activeModel);
  if (!modelExists) {
    u.activeModel = "gemini-3.1-flash-lite";
    savePlatformDB();
  }
  return u;
};

const getActiveChat = (u: PlatformUser): PlatformChatSession => {
  if (!u.chats[u.currentChatId]) {
    u.currentChatId = Object.keys(u.chats)[0] || Date.now().toString();
    if (!u.chats[u.currentChatId]) {
      u.chats[u.currentChatId] = { id: u.currentChatId, name: "Главный диалог", history: [] };
    }
  }
  return u.chats[u.currentChatId];
};

const getModelFriendlyName = (id: string): string => {
  const model = MODELS_INFO.find(m => m.id === id);
  return model ? model.name : id;
};

const isMultimodalModel = (id: string): boolean => {
  const model = MODELS_INFO.find(m => m.id === id);
  return model ? model.multimodal : false;
};

const checkPlatformLimit = (user: PlatformUser, modelId: string): { allowed: boolean; limit: number; current: number } => {
  const today = new Date().toISOString().split('T')[0];
  if (user.lastMessageDate !== today) {
    user.messagesToday = 0;
    user.modelMessagesToday = {};
    user.lastMessageDate = today;
    savePlatformDB();
  }
  if (!user.modelMessagesToday) {
    user.modelMessagesToday = {};
  }
  
  if (user.isSubscribed) {
    return { allowed: true, limit: 99999, current: user.modelMessagesToday[modelId] || 0 };
  }
  
  let limit = 100; // All OpenRouter models have a limit of 100 requests/day
  if (modelId === "gemini-3.5-flash") {
    limit = 5;
  } else if (modelId === "gemini-3.1-flash-lite") {
    limit = 15;
  } else if (modelId === "google/gemma-4-31b-it:free") {
    limit = 50;
  }
  
  const current = user.modelMessagesToday[modelId] || 0;
  if (current >= limit) {
    return { allowed: false, limit, current };
  }
  
  return { allowed: true, limit, current };
};

const handlePlatformInput = async (ctx: any, text: string) => {
  if (ctx.chat?.type !== 'private') {
     const botUsername = ctx.botInfo?.username || "WolffAIPlatform_bot";
     const isReplyToBot = ctx.message?.reply_to_message?.from?.id === ctx.botInfo?.id;
     
     const textLower = text.toLowerCase();
     const isMentioned = textLower.includes(botUsername.toLowerCase());

     if (!isReplyToBot && !isMentioned) {
         return;
     }
     
     const mentionRegex = new RegExp(`@?${botUsername}`, 'ig');
     text = text.replace(mentionRegex, '').trim();
  }

  const u = getInitPlatformUser(ctx);

  const upperText = (text || "").toUpperCase();
  if (upperText.includes("MAXVERSTAPPENBEST") || upperText.includes("KOSTASDEBIL")) {
     if (!u.isSubscribed) {
       u.isSubscribed = true;
       savePlatformDB();
       await ctx.reply("✅ Промокод применен!\n\nВы получили статус PRO (1 месяц): переключайтесь на любые модели ИИ на платформе без ограничений на 30 дней.");
     } else {
       await ctx.reply("❕ Промокод уже был активирован, у вас уже есть PRO.");
     }
     return;
  }

  const limitCheck = checkPlatformLimit(u, u.activeModel);
  if (!limitCheck.allowed) {
     return ctx.reply(
       `⚠️ <b>Ваш дневной лимит (${limitCheck.limit} запросов) на модель ${getModelFriendlyName(u.activeModel)} исчерпан!</b>\n\n` +
       `Чтобы снять все ограничения, вы можете приобрести подписку <b>PRO (1 месяц)</b> всего за <b>100 Telegram Stars 🌟</b>.\n\n` +
       `Или вы можете продолжить бесплатное общение в нашем основном боте: @WolffAI_bot\n\n` +
       `<i>Для мгновенной активации нажмите кнопку ниже (откроется счет в звездах):</i>`,
       {
         parse_mode: "HTML",
         ...Markup.inlineKeyboard([
           [Markup.button.callback("🌟 Купить PRO (100 Stars / мес)", "buy_pro")],
           [Markup.button.url("🤖 Перейти в обычного бота", "https://t.me/WolffAI_bot")]
         ])
       }
     ).catch(console.error);
  }

  // Increment usage counters
  if (!u.modelMessagesToday) u.modelMessagesToday = {};
  u.modelMessagesToday[u.activeModel] = (u.modelMessagesToday[u.activeModel] || 0) + 1;
  u.messagesToday += 1;
  savePlatformDB();

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
     return ctx.reply("🔌 Ошибка: Администратор не установил OPENROUTER_API_KEY на сервере.");
  }

  let statusMsg: any = null;
  try {
     statusMsg = await ctx.reply(`🧠 Модель [${getModelFriendlyName(u.activeModel)}] думает...`).catch(() => null);
  } catch (e) {
     console.error("Failed to send statusMsg:", e);
  }

  const typingInterval = setInterval(() => {
     ctx.sendChatAction("typing").catch(()=>{});
  }, 4000);

  try {
     let textContent = text || "";
     let mediaData: { data: string; mimeType: string } | null = null;

     // Handle photos
     if (ctx.message.photo) {
        const photo = ctx.message.photo.pop();
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const res = await fetch(fileLink.toString());
        if (res.ok) {
          const buf = await res.arrayBuffer();
          mediaData = {
            data: Buffer.from(buf).toString('base64'),
            mimeType: "image/jpeg"
          };
        }
     }

     // Handle stickers
     if (ctx.message.sticker) {
        const sticker = ctx.message.sticker;
        try {
           const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
           const res = await fetch(fileLink.toString());
           if (res.ok) {
             const buf = await res.arrayBuffer();
             mediaData = {
               data: Buffer.from(buf).toString('base64'),
               mimeType: "image/webp"
             };
           }
        } catch (e) {
           console.error("Error downloading sticker:", e);
        }
        if (sticker.emoji) {
           textContent = textContent ? `${textContent} (Отправлен стикер: ${sticker.emoji})` : `(Отправлен стикер: ${sticker.emoji})`;
        }
     }

     // Handle animations/GIFs
     if (ctx.message.animation) {
        const animation = ctx.message.animation;
        try {
           const fileLink = await ctx.telegram.getFileLink(animation.file_id);
           const res = await fetch(fileLink.toString());
           if (res.ok) {
             const buf = await res.arrayBuffer();
             mediaData = {
               data: Buffer.from(buf).toString('base64'),
               mimeType: "image/gif"
             };
           }
        } catch (e) {
           console.error("Error downloading animation:", e);
        }
     }

     // Handle media documents
     if (ctx.message.document) {
        const doc = ctx.message.document;
        const mime = doc.mime_type || "";
        if (mime.startsWith("image/")) {
           try {
              const fileLink = await ctx.telegram.getFileLink(doc.file_id);
              const res = await fetch(fileLink.toString());
              if (res.ok) {
                const buf = await res.arrayBuffer();
                mediaData = {
                  data: Buffer.from(buf).toString('base64'),
                  mimeType: mime
                };
              }
           } catch (e) {
              console.error("Error downloading document media:", e);
           }
        }
     }

     const chat = getActiveChat(u);
     const isMultimodal = isMultimodalModel(u.activeModel);
     let userMsgContent: any = textContent;

     if (mediaData) {
       if (isMultimodal) {
         userMsgContent = [
           { type: "text", text: textContent || "Посмотри это изображение." },
           {
             type: "image_url",
             image_url: {
               url: `data:${mediaData.mimeType};base64,${mediaData.data}`
             }
           }
         ];
       } else {
         userMsgContent = (textContent ? `${textContent}\n[Отправлено медиа, но активная модель ${getModelFriendlyName(u.activeModel)} является текстовой и не имеет зрения]` : `[Отправлено медиа, но активная модель ${getModelFriendlyName(u.activeModel)} не поддерживает зрение. Пожалуйста, используйте модель Gemini или GPT-4o Mini]`);
       }
     } else if (!textContent) {
       if (typingInterval) clearInterval(typingInterval);
       if (statusMsg) {
         await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
       }
       return;
     }

     chat.history.push({ role: "user", content: userMsgContent });
     
     if (chat.history.length > 24) {
       chat.history = chat.history.slice(chat.history.length - 24);
     }

      const generateModelContent = async (modelId: string, history: any[]): Promise<string> => {
        if (modelId.startsWith("gemini-")) {
          if (!aiClient) {
            throw new Error("Официальный Google Gemini API не инициализирован. Проверьте GEMINI_API_KEY.");
          }
          const contents = historyToGeminiContents(history);
          const geminiResponse = await withTimeout(
            aiClient.models.generateContent({
              model: modelId,
              contents: contents,
            }),
            25000,
            "Официальный Google Gemini API слишком долго отвечает."
          );
          const txt = geminiResponse.text || "";
          if (!txt) {
            throw new Error("Получен пустой ответ от Google Gemini API.");
          }
          return txt;
        } else {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 seconds timeout
          
          try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openrouterKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.APP_URL || "https://ais-dev.europe-west1.run.app",
                "X-Title": "WolffAIPlatform"
              },
              body: JSON.stringify({
                model: modelId,
                messages: history
              }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              const errText = await response.text();
              throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
            }

            const apiData: any = await response.json();
            const txt = apiData.choices?.[0]?.message?.content || "";
            if (!txt) {
              throw new Error("Пустой ответ от OpenRouter API.");
            }
            return txt;
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            if (fetchErr.name === 'AbortError') {
              throw new Error("OpenRouter отвечает слишком долго.");
            }
            throw fetchErr;
          }
        }
      };

      let replyText = "";
      let activeModelAttempt = (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') ? "gemini-3.1-flash-lite" : u.activeModel;
      let usedFallback = false;
      let fallbackErrorMsg = "";

      try {
        replyText = await generateModelContent(activeModelAttempt, chat.history);
      } catch (genErr: any) {
        console.error(`First attempt to generate with model ${activeModelAttempt} failed:`, genErr);
        fallbackErrorMsg = genErr.message || String(genErr);
         
        // Define fallback candidates to guarantee all models work without exception
        const fallbacks = [ "gemini-3.5-flash", "gemini-3.1-flash-lite", "google/gemma-4-31b-it:free", "meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-coder:free" ].filter(m => m !== u.activeModel);

        for (const candidate of fallbacks) {
          try {
            console.log(`Starting fallback attempt with model: ${candidate}`);
            replyText = await generateModelContent(candidate, chat.history);
            activeModelAttempt = candidate;
            usedFallback = true;
            break;
          } catch (fallbackErr) {
            console.error(`Fallback model ${candidate} failed:`, fallbackErr);
          }
        }

        if (!replyText) {
          chat.history.pop();
          const errText = `❌ Ни одна из доступных моделей ИИ не смогла ответить на ваш запрос из-за временных проблем с провайдерами.\n\nПервоначальная ошибка (${getModelFriendlyName(u.activeModel)}):\n${fallbackErrorMsg}`;
          if (statusMsg) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errText).catch(async () => {
               await ctx.reply(errText);
            });
          } else {
            await ctx.reply(errText);
          }
          return;
        }
      }

      if (usedFallback) {
        replyText += `\n\n⚠️ *Примечание: Исходная модель [${getModelFriendlyName(u.activeModel)}] оказалась временно недоступна. Автоматически применена резервная модель [${getModelFriendlyName(activeModelAttempt)}].*`;
      }


     chat.history.push({ role: "assistant", content: replyText });
     savePlatformDB();

     if (statusMsg) {
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, replyText, { parse_mode: "Markdown" }).catch(async () => {
           await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, replyText).catch(async () => {
              await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
                 await ctx.reply(replyText);
              });
           });
        });
     } else {
        await ctx.reply(replyText, { parse_mode: "Markdown" }).catch(async () => {
           await ctx.reply(replyText);
        });
     }

  } catch (err: any) {
     console.error("Platform Bot general handler error:", err);
     const errMsg = `❌ Не удалось завершить запрос. Пожалуйста, перезапустите диалог с помощью /clear.`;
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

export function initPlatformBot(app: express.Express) {
  // --- Web API Endpoints for PlatformBot ---
  
  // 1. Get Models List
  app.get("/api/chat/platform/models", (req, res) => {
    res.json(MODELS_INFO);
  });

  // Helper to init web user
  const getInitPlatformUserWeb = (userId: string): PlatformUser => {
    const defaultChatId = "chat_" + Date.now().toString();
    if (!platformUsers[userId]) {
      platformUsers[userId] = {
        id: 0,
        username: "web_user",
        firstName: "Веб-Пользователь",
        joinedAt: new Date().toISOString(),
        activeModel: "gemini-3.1-flash-lite",
        chats: {
          [defaultChatId]: { id: defaultChatId, name: "Главный диалог", history: [] }
        },
        currentChatId: defaultChatId,
        messagesToday: 0,
        lastMessageDate: new Date().toISOString().split('T')[0],
        isSubscribed: true // Web users get PREMIUM directly for awesome testing
      };
      savePlatformDB();
    }
    const u = platformUsers[userId];
    const modelExists = MODELS_INFO.some(m => m.id === u.activeModel);
    if (!modelExists) {
      u.activeModel = "gemini-3.1-flash-lite";
      savePlatformDB();
    }
    return u;
  };

  // 2. Clear Context
  app.post("/api/chat/platform/clear", (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const u = getInitPlatformUserWeb(sessionId);
    const chat = getActiveChat(u);
    chat.history = [];
    savePlatformDB();
    res.json({ success: true, message: "Контекст WolffAIPlatform очищен!" });
  });

  // 3. Set Active Model
  app.post("/api/chat/platform/set-model", (req, res) => {
    const { sessionId, modelId } = req.body;
    if (!sessionId || !modelId) {
      return res.status(400).json({ error: "Missing sessionId or modelId" });
    }
    const u = getInitPlatformUserWeb(sessionId);
    const modelExists = MODELS_INFO.some(m => m.id === modelId);
    if (!modelExists) {
      return res.status(404).json({ error: "Model not found" });
    }
    u.activeModel = modelId;
    savePlatformDB();
    res.json({ success: true, activeModel: u.activeModel, modelFriendlyName: getModelFriendlyName(u.activeModel) });
  });

  // 4. Get Status
  app.get("/api/chat/platform/status", (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const u = getInitPlatformUserWeb(sessionId);
    const chat = getActiveChat(u);
    const today = new Date().toISOString().split('T')[0];
    if (u.lastMessageDate !== today) {
       u.messagesToday = 0;
       u.modelMessagesToday = {};
       u.lastMessageDate = today;
       savePlatformDB();
    }
    const limitCheck = checkPlatformLimit(u, u.activeModel);
    res.json({
      activeModel: u.activeModel,
      activeModelFriendlyName: getModelFriendlyName(u.activeModel),
      isSubscribed: u.isSubscribed,
      messagesToday: u.messagesToday,
      limitCheck,
      history: chat.history
    });
  });

  // 5. Send Web Message to PlatformBot
  app.post("/api/chat/platform/message", async (req, res) => {
    const { sessionId, message, attachments } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: "Missing sessionId or message" });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const u = getInitPlatformUserWeb(sessionId);
    
    // Auto fallback to Gemini 3.5 Flash if OpenRouter key is missing and selected model is non-Gemini.
    let currentModel = u.activeModel;
    let fallbackDueToNoKey = false;
    if (!currentModel.startsWith("gemini-") && !openrouterKey) {
      currentModel = "gemini-3.5-flash";
      fallbackDueToNoKey = true;
    }

    try {
      const limitCheck = checkPlatformLimit(u, currentModel);
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: `Дневной лимит для модели ${getModelFriendlyName(currentModel)} исчерпан.` });
      }

      // Track usage
      if (!u.modelMessagesToday) u.modelMessagesToday = {};
      u.modelMessagesToday[currentModel] = (u.modelMessagesToday[currentModel] || 0) + 1;
      u.messagesToday += 1;
      savePlatformDB();

      const chat = getActiveChat(u);
      
      let userRepresentation: any = message;
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        const contentArr: any[] = [{ type: 'text', text: message }];
        for (const att of attachments) {
          if (att.base64 && att.mimeType) {
            contentArr.push({
              type: 'image_url',
              image_url: {
                url: `data:${att.mimeType};base64,${att.base64}`
              }
            });
          }
        }
        userRepresentation = contentArr;
      }

      chat.history.push({ role: "user", content: userRepresentation });
      if (chat.history.length > 24) {
        chat.history = chat.history.slice(chat.history.length - 24);
      }

      const generateModelContentWeb = async (modelId: string, history: any[]): Promise<string> => {
        if (modelId.startsWith("gemini-")) {
          if (!aiClient) {
            throw new Error("Google Gemini API не инициализирован.");
          }
          const contents = historyToGeminiContents(history);
          const geminiResponse = await withTimeout(
            aiClient.models.generateContent({
              model: modelId,
              contents: contents,
            }),
            25000,
            "Google Gemini API ответил тайм-аутом."
          );
          return geminiResponse.text || "";
        } else {
          if (!openrouterKey) {
            throw new Error("OPENROUTER_API_KEY не задан.");
          }
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 25000);
          try {
            const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openrouterKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": process.env.APP_URL || "https://ais-dev.europe-west1.run.app",
                "X-Title": "WolffAIPlatform"
              },
              body: JSON.stringify({
                model: modelId,
                messages: history
              }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!apiRes.ok) {
              const errText = await apiRes.text();
              throw new Error(`OpenRouter HTTP ${apiRes.status}: ${errText}`);
            }
            const apiData: any = await apiRes.json();
            return apiData.choices?.[0]?.message?.content || "";
          } catch (e) {
            clearTimeout(timeoutId);
            throw e;
          }
        }
      };

      let replyText = "";
      let activeModelAttempt = currentModel;
      let usedFallback = false;
      let fallbackErrorMsg = "";

      try {
        replyText = await generateModelContentWeb(activeModelAttempt, chat.history);
      } catch (err: any) {
        console.error(`Web PlatformBot attempt failed with ${activeModelAttempt}:`, err);
        fallbackErrorMsg = err.message || String(err);
        
        const fallbacks = ["gemini-3.5-flash", "gemini-3.1-flash-lite"].filter(m => m !== currentModel);
        for (const candidate of fallbacks) {
          try {
            replyText = await generateModelContentWeb(candidate, chat.history);
            activeModelAttempt = candidate;
            usedFallback = true;
            break;
          } catch (fErr) {
            console.error(`Fallback failed: ${candidate}`, fErr);
          }
        }

        if (!replyText) {
          chat.history.pop();
          savePlatformDB();
          return res.status(502).json({ error: `Все модели ИИ временно недоступны. Ошибка: ${fallbackErrorMsg}` });
        }
      }

      if (usedFallback || fallbackDueToNoKey) {
        replyText += `\n\n⚠️ *Примечание: Модель [${getModelFriendlyName(u.activeModel)}] требует настройки OpenRouter на сервере или временно недоступна. Автоматически применена модель [${getModelFriendlyName(activeModelAttempt)}].*`;
      }

      chat.history.push({ role: "assistant", content: replyText });
      savePlatformDB();

      res.json({ replyText, history: chat.history });
    } catch (err: any) {
      console.error("Web platform-message error:", err);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  const isProd = process.env.NODE_ENV === "production";
  const webhookDomain = isProd ? (process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app") : null;
  const token = process.env.PLATFORM_TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("PLATFORM_TELEGRAM_BOT_TOKEN missing in env.");
    return;
  }

  const bot = new Telegraf(token);

  // Telegram Stars Invoice Sender helper
  const sendProInvoice = async (ctx: any) => {
    try {
      await ctx.replyWithInvoice({
        title: "🌟 Подписка PRO (1 месяц)",
        description: "Безлимитный доступ ко всем ИИ-моделям на платформе WolffAIPlatform на 30 дней.",
        payload: "platform_pro_1_month",
        provider_token: "", // Пустой токен для Telegram Stars
        currency: "XTR",
        prices: [{ label: "PRO Подписка 1 месяц", amount: 100 }]
      });
    } catch (err: any) {
      console.error("Error sending invoice:", err);
      // Fallback message with manual support info
      await ctx.reply(
        "❌ Не удалось создать официальный счет на оплату через Telegram Stars.\n" +
        "Вы можете использовать промокоды (например, <code>MAXVERSTAPPENBEST</code> или <code>KOSTASDEBIL</code>) для мгновенной PRO-активации!",
        { parse_mode: "HTML" }
      );
    }
  };

  bot.start((ctx) => {
    const u = getInitPlatformUser(ctx);
    ctx.reply(
      `👋 Привет, ${ctx.from.first_name}!\n\n` +
      `Добро пожаловать на мультимодельную платформу <b>WolffAIPlatform</b>!\n\n` +
      `Здесь вы можете переключаться между лучшими языковыми моделями мира, изолированными друг от друга:\n` +
      `🤖 <b>Gemini 3.5 Flash, Gemini 3.1 Flash Lite, Gemma 4 31B, Llama 3.3 70B, Hermes 405B</b> и другими передовыми моделями!\n\n` +
      `⚠️ <b>Дневные лимиты для бесплатного аккаунта:</b>\n` +
      `• Gemini 3.5 Flash: <b>5 запросов</b>\n` +
      `• Gemini 3.1 Flash Lite: <b>15 запросов</b>\n` +
      `• Gemma 4 31B: <b>50 запросов</b>\n` +
      `• Остальные OpenRouter модели (Llama 3.3, Hermes 3 и др.): <b>100 запросов</b>\n\n` +
      `🌟 Оформите <b>PRO подписку на 1 месяц за 100 звезд (Telegram Stars)</b> для полной отмены лимитов или продолжайте пользоваться бесплатным стандартным ИИ-ботом.\n\n` +
      `🛠️ <b>Основные команды:</b>\n` +
      `🤖 /models — Выбрать активную ИИ-модель\n` +
      `🧹 /clear — Сбросить диалог и историю контекста\n` +
      `📈 /status — Показать лимиты и текущую модель\n` +
      `💳 /buypro — Купить PRO подписку (100 Stars / мес)\n` +
      `🔑 /promo [код] — Ввести промокод на скидку/активацию\n\n` +
      `Присылайте любые вопросы, фото, стикеры или гифки! 👇`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🤖 Выбрать модель", "show_models_list")],
          [Markup.button.callback("🌟 Купить PRO (100 Stars)", "buy_pro")],
          [Markup.button.url("🤖 Обычный бот", "https://t.me/WolffAI_bot")]
        ])
      }
    ).catch(console.error);
  });

  bot.command("promo", async (ctx) => {
    try {
      const u = getInitPlatformUser(ctx);
      const text = (ctx.message as any)?.text || "";
      const parts = text.split(/\s+/).filter((p: string) => p.trim() !== "");
      if (parts.length < 2) return ctx.reply("❌ Введите промокод, например: /promo CODE");
      
      const code = parts.slice(1).join("").toUpperCase();
      if (code.includes("MAXVERSTAPPENBEST") || code.includes("KOSTASDEBIL")) {
         if (!u.isSubscribed) {
           u.isSubscribed = true;
           savePlatformDB();
           await ctx.reply("✅ Промокод успешно применен!\n\nВы получили статус PRO (1 месяц): все модели ИИ теперь доступны полностью без ограничений на 30 дней.");
         } else {
           await ctx.reply("❕ Промокод уже был активирован, у вас уже есть статус PRO.");
         }
      } else {
         await ctx.reply(`❌ Промокод не найден или устарел. Проверьте правильность ввода.`);
      }
    } catch (err) {
       console.error("Platform Promo Command Error:", err);
    }
  });

  bot.command("buypro", sendProInvoice);
  bot.action("buy_pro", sendProInvoice);

  bot.action("show_models_list", (ctx) => {
    ctx.answerCbQuery().catch(()=>{});
    const u = getInitPlatformUser(ctx);
    const buttons = MODELS_INFO.map(m => {
      const activeIndicator = u.activeModel === m.id ? "✅ " : "   ";
      // Use index instead of ID to avoid 64-byte limit in Telegram callback data
      const mIndex = MODELS_INFO.findIndex(mi => mi.id === m.id);
      return [Markup.button.callback(`${activeIndicator}${m.name}`, `set_model:${mIndex}`)];
    });

    ctx.reply(
      `🤖 <b>Выбор ИИ Модели:</b>\n\n` +
      MODELS_INFO.map(m => `• <b>${m.name}</b>: ${m.desc}`).join("\n\n") + 
      `\n\nВыберите модель из списка на клавиатуре ниже для переключения:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    ).catch(console.error);
  });

  bot.command("models", (ctx) => {
    const u = getInitPlatformUser(ctx);
    const buttons = MODELS_INFO.map(m => {
      const activeIndicator = u.activeModel === m.id ? "✅ " : "   ";
      // Use index instead of ID to avoid 64-byte limit in Telegram callback data
      const mIndex = MODELS_INFO.findIndex(mi => mi.id === m.id);
      return [Markup.button.callback(`${activeIndicator}${m.name}`, `set_model:${mIndex}`)];
    });

    ctx.reply(
      `🤖 <b>Выбор ИИ Модели:</b>\n\n` +
      MODELS_INFO.map(m => `• <b>${m.name}</b>: ${m.desc}`).join("\n\n") + 
      `\n\nВыберите модель из списка на клавиатуре ниже для переключения:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    ).catch(console.error);
  });

  bot.action(/set_model:(.+)/, async (ctx) => {
    const modelIndex = parseInt(ctx.match[1], 10);
    const model = MODELS_INFO[modelIndex]?.id;
    if (!model) {
       ctx.answerCbQuery("Ошибка: Модель не найдена.").catch(()=>{});
       return;
    }
    const u = getInitPlatformUser(ctx);
    u.activeModel = model;
    savePlatformDB();
    const modelName = getModelFriendlyName(model);
    try {
      await ctx.answerCbQuery(`Выбран ИИ: ${modelName}`);
    } catch {}
    await ctx.editMessageText(
      `✅ Вы переключились на модель: <b>${modelName}</b>\n\n` +
      `Контекст диалога полностью изолирован. Можете присылать свои вопросы, фотографии, стикеры или GIF напрямую в чат!`,
      { parse_mode: "HTML" }
    ).catch(console.error);
  });

  bot.command("clear", (ctx) => {
    const u = getInitPlatformUser(ctx);
    const chat = getActiveChat(u);
    chat.history = [];
    savePlatformDB();
    ctx.reply("🧹 Текущий диалог в WolffAIPlatform очищен! История сообщений удалена.");
  });

  bot.command("status", (ctx) => {
    const u = getInitPlatformUser(ctx);
    const today = new Date().toISOString().split('T')[0];
    if (u.lastMessageDate !== today) {
       u.messagesToday = 0;
       u.modelMessagesToday = {};
       u.lastMessageDate = today;
       savePlatformDB();
    }
    
    const limitCheck = checkPlatformLimit(u, u.activeModel);
    
    let limitText = "";
    if (u.isSubscribed) {
      limitText = `Безлимит (PRO статус активен) - использовано ${limitCheck.current} запросов`;
    } else {
      limitText = `${limitCheck.current} / ${limitCheck.limit} запросов`;
    }

    const text = `🤖 <b>Ваш статус на WolffAIPlatform:</b>\n\n` +
      `• <b>Активная модель:</b> ${getModelFriendlyName(u.activeModel)}\n` +
      `• <b>Использовано на этой модели сегодня:</b> ${limitText}\n` +
      `• <b>Статус PRO:</b> ${u.isSubscribed ? "✅ Активен (Безлимит)" : "❌ Отсутствует (Подписка PRO: 100 Stars / мес)"}`;

    if (u.isSubscribed) {
      ctx.reply(text, { parse_mode: "HTML" }).catch(console.error);
    } else {
      ctx.reply(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🌟 Активировать PRO (100 Stars / мес)", "buy_pro")],
          [Markup.button.url("🤖 Перейти в обычного бота", "https://t.me/WolffAI_bot")]
        ])
      }).catch(console.error);
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("Error answering pre checkout query:", err);
    }
  });

  bot.on("successful_payment", async (ctx) => {
    try {
      const u = getInitPlatformUser(ctx);
      u.isSubscribed = true;
      savePlatformDB();
      await ctx.reply(
        "🎉 <b>Оплата успешно подтверждена!</b>\n\n" +
        "Вы получили вечный статус <b>БЕЗЛИМИТНЫЙ PRO</b> на WolffAIPlatform!\n" +
        "Запросы ко всем передовым моделям ИИ теперь полностью безлимитны. Спасибо за поддержку!",
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("Error confirming successful payment:", err);
    }
  });

  bot.on(message("text"), (ctx) => handlePlatformInput(ctx, (ctx.message as any).text));
  bot.on(message("photo"), (ctx) => handlePlatformInput(ctx, (ctx.message as any).caption || ""));
  bot.on(message("sticker"), (ctx) => handlePlatformInput(ctx, (ctx.message as any).caption || ""));
  bot.on(message("animation"), (ctx) => handlePlatformInput(ctx, (ctx.message as any).caption || ""));
  bot.on(message("document"), (ctx) => handlePlatformInput(ctx, (ctx.message as any).caption || ""));

  bot.catch((err, ctx) => {
    console.error(`Platform Bot encountered an error for ${ctx.updateType}`, err);
  });

  const startBotPolling = (b: Telegraf) => {
    let active = true;
    const run = async () => {
      while (active) {
        try {
          console.log(`[Platform Bot] Cleaning webhook and preparing to start polling...`);
          await b.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
          await b.launch();
          console.log(`[Platform Bot] Polling started cleanly.`);
          break; // If launch returns naturally, exit the loop
        } catch (err: any) {
          if (!active) break;
          console.error(`[Platform Bot] Polling error encountered:`, err);
          const errMsg = String(err).toLowerCase();
          let delay = 5000;
          if (errMsg.includes("conflict") || errMsg.includes("409")) {
            console.warn(`[Platform Bot] 409 Conflict detected. Older dev processes might be closing. Retrying in 12s...`);
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

  const stopBot = startBotPolling(bot);

  process.once("SIGINT", () => {
    stopBot();
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopBot();
    bot.stop("SIGTERM");
  });
}
