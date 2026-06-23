import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { activatePromo } from "./src/lib/promoService";

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
  const alternating: Array<{ role: 'user' | 'model'; parts: any[] }> = [];

  for (const turn of history) {
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

    if (alternating.length > 0 && alternating[alternating.length - 1].role === role) {
      alternating[alternating.length - 1].parts.push(...parts);
    } else {
      alternating.push({ role, parts });
    }
  }

  return alternating;
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
  promoUsed?: string;
  proRevoked?: boolean;
}

const DB_PLATFORM_FILE = path.join(process.cwd(), "platform_users.json");

export let platformUsers: Record<string, PlatformUser> = {};

export const groupPlatformChats: Record<string, { id: string; history: any[] }> = {};

export const getGroupPlatformChat = (groupId: string | number) => {
  const key = String(groupId);
  if (!groupPlatformChats[key]) {
    groupPlatformChats[key] = { id: key, history: [] };
  }
  return groupPlatformChats[key];
};

if (fs.existsSync(DB_PLATFORM_FILE)) {
  try {
    const data = fs.readFileSync(DB_PLATFORM_FILE, "utf-8");
    platformUsers = JSON.parse(data);
  } catch (e) {
    console.error("Error reading platform_users.json:", e);
  }
}

export const savePlatformDB = () => {
  try {
    fs.writeFileSync(DB_PLATFORM_FILE, JSON.stringify(platformUsers, null, 2));
  } catch (err) {
    console.error("Error writing platform_users.json:", err);
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function sendRobustReply(ctx: any, text: string, statusMsg?: any) {
  const CHUNK_SIZE = 4000;
  if (!text) return;

  const chunks: string[] = [];
  if (text.length <= CHUNK_SIZE) {
    chunks.push(text);
  } else {
    let current = "";
    const lines = text.split("\n");
    for (const line of lines) {
      if (current.length + line.length + 1 > CHUNK_SIZE) {
        if (current) {
          chunks.push(current);
          current = "";
        }
        if (line.length > CHUNK_SIZE) {
          for (let i = 0; i < line.length; i += CHUNK_SIZE) {
            chunks.push(line.slice(i, i + CHUNK_SIZE));
          }
        } else {
          current = line;
        }
      } else {
        current = current ? (current + "\n" + line) : line;
      }
    }
    if (current) {
      chunks.push(current);
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i === 0 && statusMsg) {
      const success = await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, chunk, { parse_mode: "Markdown" })
        .then(() => true)
        .catch(async () => {
          return await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, chunk)
            .then(() => true)
            .catch(() => false);
        });
      
      if (!success) {
        await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(async () => {
          await ctx.reply(chunk).catch(console.error);
        });
      }
    } else {
      await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(async () => {
        await ctx.reply(chunk).catch(console.error);
      });
    }
  }
}

async function generateContentWithRetryAndFallback(modelId: string, history: any[]): Promise<{ text: string; actualModelUsed: string; usedFallback: boolean }> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openmodelKey = process.env.OPENMODEL_API_KEY || "om-2EYR7FAxLYTj197dyvQU6hoGcixLfEP7zsegu3TctHt";
  const puterToken = process.env.PUTER_AUTH_TOKEN;

  const tryGenerateOnce = async (mId: string): Promise<string> => {
    try {
      if (mId === "deepseek-v4-flash") {
        // Try OpenModel first
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch("https://api.openmodels.run/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${openmodelKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "deepseek-v4-flash",
              messages: history
            }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (response.ok) {
            const apiData: any = await response.json();
            const txt = apiData.choices?.[0]?.message?.content || "";
            if (txt) return txt;
          }
        } catch (err) {
          clearTimeout(timeoutId);
          console.warn("[OpenModels] deepseek-v4-flash attempt failed:", err);
        }

        // If OpenModels failed, try OpenRouter using appropriate IDs
        if (openrouterKey) {
          const controller2 = new AbortController();
          const timeoutId2 = setTimeout(() => controller2.abort(), 12000);
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
                model: "deepseek/deepseek-v4-flash",
                messages: history
              }),
              signal: controller2.signal
            });
            clearTimeout(timeoutId2);
            if (response.ok) {
              const apiData: any = await response.json();
              const txt = apiData.choices?.[0]?.message?.content || "";
              if (txt) return txt;
            }
          } catch (orErr: any) {
            clearTimeout(timeoutId2);
            console.warn("[OpenRouter] deepseek-v4-flash attempt failed:", orErr.message || orErr);
          }
        }

        throw new Error("Both attempts failed.");
      } else if (mId.startsWith("gemini-") && !mId.includes("/")) {
        if (!aiClient) {
          throw new Error("Google Gemini API client is not initialized.");
        }
        const contents = historyToGeminiContents(history);
        let realModel = mId;
        if (mId === "gemini-3.5-flash") {
          realModel = "gemini-2.5-flash";
        } else if (mId === "gemini-3.1-pro-preview") {
          realModel = "gemini-2.5-flash"; // Fallback because 3.1-pro-preview usually rate-limited on free tier
        }
        const geminiResponse = await withTimeout(
          aiClient.models.generateContent({
            model: realModel,
            contents: contents,
          }),
          90000,
          "Google Gemini API timeout."
        );
        const txt = geminiResponse.text || "";
        if (!txt) {
           throw new Error("Empty response from Google Gemini API.");
        }
        return txt;
      } else {
        // OpenRouter models
        if (openrouterKey) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000);
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
                model: mId,
                messages: history
              }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (response.ok) {
              const apiData: any = await response.json();
              const txt = apiData.choices?.[0]?.message?.content || "";
              if (txt) return txt;
            }
          } catch (e) {
            clearTimeout(timeoutId);
            console.warn(`[OpenRouter] ${mId} failed:`, e);
          }
        }

        throw new Error("Model query failed.");
      }
    } catch (outerErr: any) {
      console.warn("Outer tryGenerateOnce error:", outerErr);
      throw outerErr;
    }
  };

  const maxRetries = 2;
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[UnifiedGen] Attempt ${attempt} for model: ${modelId}`);
      const text = await tryGenerateOnce(modelId);
      return { text, actualModelUsed: modelId, usedFallback: false };
    } catch (err: any) {
      console.warn(`[UnifiedGen] Attempt ${attempt} failed for model ${modelId}:`, err.message || err);
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(1000);
      }
    }
  }

  // Fallback to gemini-2.5-flash if everything else failed, and if the current model wasn't gemini-2.5-flash
  if (modelId !== "gemini-2.5-flash" && aiClient) {
     try {
       console.log(`[UnifiedGen] Falling back to gemini-2.5-flash after failure of ${modelId}`);
       const text = await tryGenerateOnce("gemini-2.5-flash");
       return { text, actualModelUsed: "gemini-2.5-flash", usedFallback: true };
     } catch (fallbackErr: any) {
       console.error(`[UnifiedGen] Fallback also failed:`, fallbackErr);
     }
  }

  throw new Error(`Простите, все попытки получить ответ не удались. Ошибка: ${lastError?.message || lastError}`);
}

const MODELS_INFO = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", desc: "Ультрабыстрый мультимодальный флагман Google.", multimodal: true },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", desc: "Сверхмощная экспериментальная модель Google.", multimodal: true },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", desc: "Надежная быстрая мультимодальная модель.", multimodal: true },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", desc: "Супер-быстрая и легкая версия Gemini. (Резервная)", multimodal: true },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (OpenModel)", desc: "Быстрая и эффективная модель следующего поколения от OpenModel.", multimodal: false },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B", desc: "Мощная открытая модель от Meta.", multimodal: false },
  { id: "nousresearch/hermes-3-llama-3.1-405b:free", name: "Hermes 3 405B", desc: "Сверхмощная открытая модель от NousResearch.", multimodal: false },
  { id: "qwen/qwen3-coder:free", name: "Qwen 3 Coder", desc: "Продвинутая модель для написания кода.", multimodal: false },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", desc: "Открытая текстовая модель от Google (OpenRouter).", multimodal: false },
  { id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", name: "Dolphin Mistral 24B", desc: "Модель без цензуры (Venice Edition).", multimodal: false },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 30B", desc: "Reasoning модель от Nvidia.", multimodal: false }
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
      activeModel: "gemini-3.1-pro-preview", // Default to the smartest model
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

  // Active Promo-duration subscription expiration checks
  if (u.isSubscribed && (u as any).premiumUntil) {
    if (new Date() > new Date((u as any).premiumUntil)) {
      u.isSubscribed = false;
      (u as any).premiumUntil = undefined;
      savePlatformDB();

      // Mirror expiration dynamically in users.json if applicable
      try {
        const uFile = 'users.json';
        if (fs.existsSync(uFile)) {
          const uData = JSON.parse(fs.readFileSync(uFile, "utf-8"));
          if (uData[userId]) {
            uData[userId].isSubscribed = false;
            uData[userId].premiumUntil = undefined;
            fs.writeFileSync(uFile, JSON.stringify(uData, null, 2), "utf-8");
          }
        }
      } catch (err) {
        console.error("Failed to propagate subscription expiration to main database from platform:", err);
      }
    }
  }
  
  // Sync PRO status from main users.json
  try {
    const mainUsersStr = fs.readFileSync('users.json', 'utf8');
    const mainUsers = JSON.parse(mainUsersStr);
    if (mainUsers[userId]) {
      if (mainUsers[userId].isSubscribed || mainUsers[userId].role === 'admin') {
        if (!u.isSubscribed) {
          u.isSubscribed = true;
          if (mainUsers[userId].premiumUntil) {
            (u as any).premiumUntil = mainUsers[userId].premiumUntil;
          }
          savePlatformDB();
        }
      } else {
        // If expired or suspended on main side, mirror it
        if (u.isSubscribed && (u as any).premiumUntil) {
          u.isSubscribed = false;
          (u as any).premiumUntil = undefined;
          savePlatformDB();
        }
      }
    }
  } catch(e) {}

  const modelExists = MODELS_INFO.some(m => m.id === u.activeModel);
  if (!modelExists) {
    u.activeModel = "gemini-3.1-pro-preview";
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
  
  const current = user.modelMessagesToday[modelId] || 0;
  
  if (user.isSubscribed) {
    return { allowed: true, limit: 99999, current };
  }
  
  let limit = 50; // Default limit for all models except specified Gemini and DeepSeek
  if (modelId === "gemini-3.5-flash") {
    limit = 5;
  } else if (modelId === "gemini-3.1-pro-preview") {
    limit = 5;
  } else if (modelId === "gemini-3.1-flash-lite") {
    limit = 45;
  } else if (modelId === "gemini-2.5-flash") {
    limit = 45;
  } else if (modelId === "deepseek-v4-flash" || modelId.toLowerCase().includes("deepseek")) {
    limit = 20;
  }

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

     if (!text) {
        text = "Привет!";
     }
  }

  const u = getInitPlatformUser(ctx);

  if (u.proRevoked) {
     return ctx.reply("❌ Ваш доступ к PRO-режиму был отключен администратором за несоблюдение правил пользования сервисом на платформе.");
  }

  // Check if message text contains any valid promocode from promocodes.json or legacy ones
  let matchedPromo = "";
  const textToSearch = (text || "").toUpperCase();
  if (textToSearch.includes("MAXVERSTAPPENBEST")) {
     matchedPromo = "MAXVERSTAPPENBEST";
  } else if (textToSearch.includes("KOSTASDEBIL")) {
     matchedPromo = "KOSTASDEBIL";
  } else {
     const match = textToSearch.match(/WAI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
     if (match) {
        matchedPromo = match[0];
     }
  }

  if (matchedPromo) {
     const pFile = path.join(process.cwd(), "promocodes.json");
     let isPromoActive = false;
     let durationMonths = -1;
     try {
       if (fs.existsSync(pFile)) {
         const pData = JSON.parse(fs.readFileSync(pFile, "utf-8"));
         const promo = pData[matchedPromo];
         if (promo) {
           // Verify not used already if one-time
           if (promo.type === "one_time" && promo.usedBy && promo.usedBy.length > 0) {
              await ctx.reply("❌ Этот промокод уже был использован.");
              return;
           }
           if (promo.usedBy && promo.usedBy.includes(ctx.from.id)) {
              await ctx.reply("❌ Вы уже активировали этот промокод.");
              return;
           }
           isPromoActive = true;
           durationMonths = promo.durationMonths || -1;
           
           // Mark as used
           promo.usedBy = promo.usedBy || [];
           promo.usedBy.push(ctx.from.id);
           fs.writeFileSync(pFile, JSON.stringify(pData, null, 2), "utf-8");
         }
       }
     } catch (e) {
       console.error("Error processing text promocode:", e);
     }

     if (isPromoActive) {
        if (!u.isSubscribed) {
          u.isSubscribed = true;
          u.promoUsed = matchedPromo;
          u.proRevoked = false;
          savePlatformDB();
          
          // Sync to standard users.json if exists
          try {
            const uFile = path.join(process.cwd(), "users.json");
            if (fs.existsSync(uFile)) {
              const uData = JSON.parse(fs.readFileSync(uFile, "utf-8"));
              if (uData[ctx.from.id]) {
                uData[ctx.from.id].isSubscribed = true;
                uData[ctx.from.id].promoUsed = matchedPromo;
                uData[ctx.from.id].proRevoked = false;
                fs.writeFileSync(uFile, JSON.stringify(uData, null, 2), "utf-8");
              }
            }
          } catch (err) {}

          await ctx.reply(`✅ Промокод ${matchedPromo} применен!\n\nВы получили БЕЗЛИМИТНЫЙ PRO статус на платформе: переключайтесь на любые модели ИИ без ограничений!`);
        } else {
          await ctx.reply("❕ Промокод уже был активирован, у вас уже есть PRO.");
        }
     } else {
        await ctx.reply("❌ Промокод не найден, срок его действия истек или достигнут лимит использований.");
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
           [Markup.button.callback("🌟 Купить PRO (150 Stars / 2 мес)", "buy_pro")],
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
     if (ctx.message?.reply_to_message) {
        const replyTo = ctx.message.reply_to_message;
        const replySender = replyTo.from?.first_name || (replyTo.from?.username ? `@${replyTo.from.username}` : "Пользователь");
        const replyText = replyTo.text || replyTo.caption || "";
        if (replyText) {
           textContent = `[Контекст: Сообщение на которое ответил пользователь (Автор: ${replySender})]:\n"${replyText}"\n\n[Текст пользователя]:\n${textContent}`;
        }
     }
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

     const isGroupChat = ctx.chat?.type !== 'private';
     const chat = isGroupChat ? getGroupPlatformChat(ctx.chat.id) : getActiveChat(u);
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
        const result = await generateContentWithRetryAndFallback(modelId, history);
        activeModelAttempt = result.actualModelUsed;
        usedFallback = result.usedFallback;
        return result.text;
      };

      let replyText = "";
      let activeModelAttempt = u.activeModel;
      let usedFallback = false;
      let fallbackErrorMsg = "";

      try {
        replyText = await generateModelContent(activeModelAttempt, chat.history);
      } catch (genErr: any) {
        console.error(`First attempt to generate with model ${activeModelAttempt} failed:`, genErr);
        fallbackErrorMsg = genErr.message || String(genErr);

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


      chat.history.push({ role: "assistant", content: replyText });
      savePlatformDB();

      if (usedFallback) {
         replyText += `\n\n_⚠️ Первичная модель была недоступна. Использован автоматический резерв: ${getModelFriendlyName(activeModelAttempt)}_`;
      }

      await sendRobustReply(ctx, replyText, statusMsg);

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
        activeModel: "gemini-3.1-pro-preview",
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
  
  // Sync PRO status from main users.json
  try {
    const mainUsersStr = fs.readFileSync('users.json', 'utf8');
    const mainUsers = JSON.parse(mainUsersStr);
    if (mainUsers[userId] && (mainUsers[userId].isSubscribed || mainUsers[userId].role === 'admin')) {
      if (!u.isSubscribed) {
        u.isSubscribed = true;
        savePlatformDB();
      }
    }
  } catch(e) {}

    const modelExists = MODELS_INFO.some(m => m.id === u.activeModel);
    if (!modelExists) {
      u.activeModel = "gemini-3.1-pro-preview";
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
    
    // Auto fallback to Gemini 3.5 Flash if selected model is wrong
    let currentModel = u.activeModel;
    let fallbackDueToNoKey = false;
    // Key validation removed for robust fallback

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
        const result = await generateContentWithRetryAndFallback(modelId, history);
        activeModelAttempt = result.actualModelUsed;
        usedFallback = result.usedFallback;
        return result.text;
      };

      let replyText = "";
      let activeModelAttempt = u.activeModel;
      let usedFallback = false;
      let fallbackErrorMsg = "";

      try {
        replyText = await generateModelContentWeb(activeModelAttempt, chat.history);
      } catch (err: any) {
        console.error(`Web PlatformBot attempt failed with ${activeModelAttempt}:`, err);
        fallbackErrorMsg = err.message || String(err);
        
        if (!replyText) {
          chat.history.pop();
          savePlatformDB();
          return res.status(502).json({ error: `Все модели ИИ временно недоступны. Ошибка: ${fallbackErrorMsg}` });
        }
      }


      if (usedFallback) {
         replyText += `\n\n_⚠️ Первичная модель была недоступна. Использован автоматический резерв: ${getModelFriendlyName(activeModelAttempt)}_`;
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
  const rawDomain = process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app";
  const isAiStudioSandbox = rawDomain.includes("ais-dev-") || rawDomain.includes("ais-pre-");
  // AI Studio preview/shared environments run behind auth which blocks Webhooks with a 302 Found redirect.
  // Therefore, start Platform bot in Polling mode for preview and Webhook mode for real deployments.
  const webhookDomain = (isProd && !isAiStudioSandbox) ? rawDomain : null;
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
        title: "🌟 Подписка PRO (2 месяца)",
        description: "Безлимитный доступ на 2 месяца ко всей экосистеме ботов Wolff AI (Мультимодельная платформа WolffAI Platform, Базовый WolffAI, Злой AngryAI). Оплата Telegram Stars.",
        payload: "platform_pro_1_month",
        provider_token: "", // Пустой токен для Telegram Stars
        currency: "XTR",
        prices: [{ label: "PRO Подписка 2 месяца", amount: 150 }]
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
      `👋 Привет, ${ctx.from.first_name}!${u.isSubscribed ? ' 💎 <b>[PRO]</b>' : ''}\n\n` +
      `Добро пожаловать на мультимодельную платформу <b>WolffAIPlatform</b>!\n\n` +
      `Здесь вы можете переключаться между лучшими языковыми моделями мира, изолированными друг от друга:\n` +
      `🤖 <b>Gemini 3.5 Flash, Gemini 3.1 Pro, Llama 3.3 70B, Hermes 405B, Qwen, Nemotron, DeepSeek</b> и другими передовыми моделями!\n\n` +
      `⚠️ <b>Дневные лимиты для бесплатного аккаунта:</b>\n` +
      `• Gemini 3.5 Flash: <b>5 запросов</b>\n` +
      `• Gemini 3.1 Pro: <b>5 запросов</b>\n` +
      `• Gemini 3.1 Flash Lite: <b>45 запросов</b>\n` +
      `• Модели DeepSeek: <b>20 запросов</b>\n` +
      `• Все остальные модели: <b>50 запросов</b>\n\n` +
      `🌟 Оформите <b>PRO подписку на 2 месяца за 150 звезд</b>. При покупке PRO вы получаете безлимитный доступ ко всей экосистеме ботов с ИИ: Мультимодельная платформа (WolffAI Platform), Базовый бот (WolffAI) и Злой бот (AngryAI)!\n\n` +
      `🛠️ <b>Основные команды:</b>\n` +
      `🤖 /models — Выбрать активную ИИ-модель\n` +
      `🧹 /clear — Сбросить диалог и историю контекста\n` +
      `📈 /status — Показать лимиты и текущую модель\n` +
      `➕ /newchat [название] — Создать новый отдельный чат\n` +
      `📂 /chats — Показать список ваших чатов\n` +
      `💳 /buypro — Купить PRO подписку (150 Stars / 2 мес)\n` +
      `🔑 /promo [код] — Ввести промокод на скидку/активацию\n\n` +
      `Присылайте любые вопросы, фото, стикеры или гифки! 👇`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🤖 Выбрать модель", "show_models_list")],
          [Markup.button.callback("🌟 Купить PRO (150 Stars)", "buy_pro")],
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

      const code = parts.slice(1).join("").trim().toUpperCase();
      
      let isValid = false;
      let durationMonths = -1;
      let isHardcoded = false;
      let promoData: any = null;
      
      if (code === "MAXVERSTAPPENBEST" || code === "KOSTASDEBIL") {
        isValid = true;
        isHardcoded = true;
      } else {
        const result = await activatePromo(code, ctx.from.id);
        if (result.success) {
          isValid = true;
          promoData = result.promo;
          durationMonths = promoData.durationMonths || -1;
        } else {
          return ctx.reply(`❌ ${result.error}`);
        }
      }

      if (isValid) {
         if (!u.isSubscribed) {
           let durationLabel = "";
           if (durationMonths === -1) {
             u.isSubscribed = true;
             (u as any).premiumUntil = undefined;
             durationLabel = "бессрочно (навсегда)";
           } else {
             u.isSubscribed = true;
             const expiryDate = new Date();
             expiryDate.setMonth(expiryDate.getMonth() + durationMonths);
             (u as any).premiumUntil = expiryDate.toISOString();
             durationLabel = `на ${durationMonths} мес. (до ${expiryDate.toLocaleDateString('ru-RU')})`;
           }
           u.promoUsed = code;
           u.proRevoked = false;
           savePlatformDB();
           
           // Sync dynamic Promo back to users.json
           try {
             const uFile = 'users.json';
             if (fs.existsSync(uFile)) {
               const uData = JSON.parse(fs.readFileSync(uFile, "utf-8"));
               if (uData[ctx.from.id]) {
                 uData[ctx.from.id].isSubscribed = true;
                 uData[ctx.from.id].promoUsed = code;
                 uData[ctx.from.id].proRevoked = false;
                 if (durationMonths !== -1) {
                   uData[ctx.from.id].premiumUntil = (u as any).premiumUntil;
                 }
                 fs.writeFileSync(uFile, JSON.stringify(uData, null, 2), "utf-8");
               }
             }
           } catch(syncErr) {
             console.error("Sync to main users during promo check error:", syncErr);
           }

           await ctx.reply(`✅ Промокод применен!\n\nВы получили PRO статус ${durationLabel}: все модели ИИ теперь доступны полностью без ограничений.`);
         } else {
           await ctx.reply("❕ У вас уже есть статус PRO. Чтобы применить новый код, текущий статус должен закончиться.");
         }
      } else {
         await ctx.reply(`❌ Промокод не найден или устарел. Проверьте правильность ввода.`);
      }
    } catch (err) {
       console.error("Platform Promo Command Error:", err);
    }
  });

  const sendPlatformPaymentMenu = async (ctx: any) => {
    try {
      const u = getInitPlatformUser(ctx);
      if (u.isSubscribed) {
        return ctx.reply("💎 У вас уже активирован PRO статус! Вы пользуетесь ботом без ограничений.");
      }
      await ctx.reply(
        `💳 <b>Оплата PRO подписки (2 месяца)</b>\n\n` +
        `Вы получите безлимитный PRO статус ко всей экосистеме Wolff AI на 2 месяца (Мультимодельная платформа WolffAI Platform, Базовый WolffAI, Злой AngryAI).\n\n` +
        `Оплата производится через Telegram Stars (150 ★).\n\n` +
        `<i>Для оплаты нажмите кнопку ниже:</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🌟 Оплатить (150 Stars / 2 мес)", "platform_buy_stars")]
          ])
        }
      );
    } catch (err) {
      console.error("sendPlatformPaymentMenu Error:", err);
    }
  };

  bot.command("buypro", sendPlatformPaymentMenu);
  bot.action("buy_pro", sendPlatformPaymentMenu);

  bot.action("platform_buy_stars", async (ctx) => {
    try {
      const u = getInitPlatformUser(ctx);
      if (u.isSubscribed) {
        await ctx.answerCbQuery("У вас уже есть PRO!").catch(()=>{});
        return ctx.reply("💎 У вас уже активирован PRO статус!");
      }
      await ctx.answerCbQuery().catch(()=>{});
      await ctx.replyWithInvoice({
        title: "🌟 Подписка PRO (2 месяца)",
        description: "Безлимитный доступ на 2 месяца ко всей экосистеме ботов Wolff AI (Мультимодельная платформа WolffAI Platform, Базовый WolffAI, Злой AngryAI). Оплата Telegram Stars.",
        payload: "platform_pro_2_months",
        provider_token: "", // Пустой токен для Telegram Stars
        currency: "XTR",
        prices: [{ label: "PRO Подписка 2 месяца", amount: 150 }]
      }).catch(async (err) => {
        console.error("Error sending platform invoice:", err);
        await ctx.reply(
          "❌ Не удалось создать официальный счет на оплату через Telegram Stars.\n" +
          "Вы можете использовать промокоды для мгновенной PRO-активации!",
          { parse_mode: "HTML" }
        );
      });
    } catch (err) {
      console.error("platform_buy_stars action error:", err);
    }
  });

  bot.action("platform_buy_sbp", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(()=>{});
      await ctx.reply(
        `❌ Этот способ оплаты более недоступен.\n\nПожалуйста, воспользуйтесь оплатой через 🌟 <b>Telegram Stars</b>. Введите команду /buypro для проведения оплаты.`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("platform_buy_sbp action error:", err);
    }
  });

  bot.action("platform_buy_crypto", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(()=>{});
      await ctx.reply(
        `❌ Этот способ оплаты более недоступен.\n\nПожалуйста, воспользуйтесь оплатой через 🌟 <b>Telegram Stars</b>. Введите команду /buypro для проведения оплаты.`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("platform_buy_crypto action error:", err);
    }
  });

  bot.action("platform_buy_inter", async (ctx) => {
    try {
      await ctx.answerCbQuery().catch(()=>{});
      await ctx.reply(
        `❌ Этот способ оплаты более недоступен.\n\nПожалуйста, воспользуйтесь оплатой через 🌟 <b>Telegram Stars</b>. Введите команду /buypro для проведения оплаты.`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("platform_buy_inter action error:", err);
    }
  });

  const showModelsMenu = async (ctx: any) => {
    const u = getInitPlatformUser(ctx);
    const buttons = MODELS_INFO.map(m => {
      const activeIndicator = u.activeModel === m.id ? "✅ " : "   ";
      const mIndex = MODELS_INFO.findIndex(mi => mi.id === m.id);
      return [Markup.button.callback(`${activeIndicator}${m.name}`, `set_model:${mIndex}`)];
    });

    const text = `🤖 <b>Выбор ИИ Модели:</b>${u.isSubscribed ? ' 💎 <b>[PRO]</b>' : ''}\n\n` +
      `👉 <b>Текущая модель:</b> <code>${getModelFriendlyName(u.activeModel)}</code>\n\n` +
      MODELS_INFO.map(m => `• <b>${m.name}</b>: ${m.desc}`).join("\n\n") + 
      `\n\nВыберите модель из списка на клавиатуре ниже для переключения:`;

    const extra = {
      parse_mode: "HTML" as const,
      ...Markup.inlineKeyboard(buttons)
    };

    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, extra).catch(async () => {
        await ctx.reply(text, extra).catch(console.error);
      });
    } else {
      await ctx.reply(text, extra).catch(console.error);
    }
  };

  bot.action("show_models_list", async (ctx) => {
    await ctx.answerCbQuery().catch(()=>{});
    await showModelsMenu(ctx);
  });

  bot.command("models", async (ctx) => {
    await showModelsMenu(ctx);
  });

  bot.action(/set_model:(.+)/, async (ctx) => {
    try {
      let matchVal: string | null = null;
      const callbackData = (ctx.callbackQuery as any)?.data || "";
      if (callbackData.startsWith("set_model:")) {
        matchVal = callbackData.split(":")[1];
      }
      if (!matchVal && (ctx as any).match) {
        matchVal = typeof (ctx as any).match === 'string' ? ((ctx as any).match as string).split(':')[1] : (ctx as any).match[1];
      }
      if (!matchVal) {
        await ctx.answerCbQuery("Ошибка выбора модели.").catch(()=>{});
        return;
      }
      const modelIndex = parseInt(matchVal, 10);
      const model = MODELS_INFO[modelIndex]?.id;
      if (!model) {
        await ctx.answerCbQuery("Ошибка: Модель не найдена.").catch(()=>{});
        return;
      }
      
      const modelName = getModelFriendlyName(model);

      const u = getInitPlatformUser(ctx);
      u.activeModel = model;
      savePlatformDB();

      // Answer instantly to eliminate any lag or loading state spinner
      await ctx.answerCbQuery(`Выбран ИИ: ${modelName}`).catch(()=>{});

      // Refresh the models list immediately so the checkmark moves to the newly chosen model!
      await showModelsMenu(ctx);
    } catch (err) {
      console.error("set_model callback error:", err);
      try {
        await ctx.answerCbQuery("Ошибка выбора модели.").catch(()=>{});
      } catch {}
    }
  });

  bot.command("newchat", async (ctx) => {
    try {
      const u = getInitPlatformUser(ctx);
      const text = (ctx.message as any)?.text || "";
      const parts = text.split(" ");
      parts.shift(); // remove command
      const name = parts.length > 0 ? parts.join(" ") : `Чат ${Object.keys(u.chats).length + 1}`;
      
      const newId = Date.now().toString();
      u.chats[newId] = { id: newId, name, history: [] };
      u.currentChatId = newId;
      savePlatformDB();
      await ctx.reply(`✅ Создан и выбран новый чат в WolffAIPlatform: <b>${name}</b>`, { parse_mode: "HTML" });
    } catch (err) {
      console.error("Platform New Chat Error:", err);
    }
  });

  bot.command("chats", async (ctx) => {
    try {
      const u = getInitPlatformUser(ctx);
      const chatList = Object.values(u.chats).slice(-20); // show up to 20 recent chats
      
      const buttons = chatList.map(c => {
         const prefix = c.id === u.currentChatId ? "👉 " : "";
         return [Markup.button.callback(`${prefix}${c.name}`, `platform_switchchat_${c.id}`)];
      });
      
      await ctx.reply(`Ваши активные чаты на WolffAIPlatform (текущий выделен):`, Markup.inlineKeyboard(buttons));
    } catch (err) {
      console.error("Platform Chats Error:", err);
    }
  });

  bot.action(/platform_switchchat_(.*)/, async (ctx) => {
    try {
      const u = getInitPlatformUser(ctx);
      const chatId = ctx.match[1];
      if (u.chats[chatId]) {
         u.currentChatId = chatId;
         savePlatformDB();
         await ctx.answerCbQuery(`Чат переключен на ${u.chats[chatId].name}`).catch(()=>{});
         await ctx.editMessageText(`✅ Вы переключились на чат на WolffAIPlatform: <b>${u.chats[chatId].name}</b>`, { parse_mode: "HTML" }).catch(()=>{});
      } else {
         await ctx.answerCbQuery("Чат не найден").catch(()=>{});
      }
    } catch (err) {
      console.error("Platform Switch Chat Error:", err);
    }
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
      `• <b>Статус PRO:</b> ${u.isSubscribed ? "✅ Активен (Безлимит)" : "❌ Отсутствует (Подписка PRO: 150 Stars / 2 мес)"}`;

    if (u.isSubscribed) {
      ctx.reply(text, { parse_mode: "HTML" }).catch(console.error);
    } else {
      ctx.reply(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🌟 Активировать PRO (150 Stars / 2 мес)", "buy_pro")],
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
      u.proRevoked = false;
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

  if (webhookDomain) {
    const cleanUrl = webhookDomain.endsWith("/") ? webhookDomain.slice(0, -1) : webhookDomain;
    const webhookUrl = `${cleanUrl}/webhook/platform`;
    console.log(`[Platform Bot] Registering Webhook: ${webhookUrl}`);
    bot.telegram.setWebhook(webhookUrl).catch(e => {
      console.error("[Platform Bot] Failed to set Webhook, falling back to polling:", e);
      startBotPolling(bot);
    });
    app.post("/webhook/platform", (req, res) => {
      bot.handleUpdate(req.body, res);
    });
  } else {
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
}
