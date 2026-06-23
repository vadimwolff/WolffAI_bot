import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import fs from "fs";
import https from "https";
import { initPlatformBot, platformUsers, savePlatformDB as savePlatformDBInBot } from "./platformBot";
import { requireAuth, AuthRequest } from "./src/middleware/auth.ts";
import { getOrCreateUser, getUserChats, upsertChat, deleteChatInDb } from "./src/db/helpers.ts";
import { getPromos, generatePromo, deletePromo } from "./src/lib/promoService";

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
  mode: 'fast' | 'thinking' | 'code' | 'search' | 'geowolff' | 'wolfflawyer' | 'wolffcode';
  modelPreference: 'gemini-2' | 'gemini-3';
  messagesToday: number;
  messagesFast?: number;
  messagesThinking?: number;
  messagesSearch?: number;
  lastMessageDate: string;
  isSubscribed: boolean;
  chats: Record<string, ChatSession>;
  currentChatId: string;
  promoUsed?: string;
  proRevoked?: boolean;
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

interface GroupChatSession {
  id: string;
  history: Array<{ role: 'user' | 'model', parts: Array<any> }>;
}

let groupChats: Record<string, GroupChatSession> = {};
let groupAngryChats: Record<string, GroupChatSession> = {};

const GROUP_DB_FILE = path.join(process.cwd(), "group_chats.json");
const GROUP_ANGRY_DB_FILE = path.join(process.cwd(), "group_angry_chats.json");

if (fs.existsSync(GROUP_DB_FILE)) {
  try {
    groupChats = JSON.parse(fs.readFileSync(GROUP_DB_FILE, "utf-8"));
  } catch (e) {
    console.error("Error reading group_chats.json:", e);
  }
}

if (fs.existsSync(GROUP_ANGRY_DB_FILE)) {
  try {
    groupAngryChats = JSON.parse(fs.readFileSync(GROUP_ANGRY_DB_FILE, "utf-8"));
  } catch (e) {
    console.error("Error reading group_angry_chats.json:", e);
  }
}

const saveGroupChats = () => {
  try {
    fs.writeFileSync(GROUP_DB_FILE, JSON.stringify(groupChats, null, 2));
  } catch (e) {
    console.error("Error saving group_chats.json:", e);
  }
};

const saveGroupAngryChats = () => {
  try {
    fs.writeFileSync(GROUP_ANGRY_DB_FILE, JSON.stringify(groupAngryChats, null, 2));
  } catch (e) {
    console.error("Error saving group_angry_chats.json:", e);
  }
};

let messageMediaCache: Record<string, { data: string, mimeType: string, timestamp: number }> = {};
const MSG_MEDIA_DB_FILE = path.join(process.cwd(), "message_media_cache.json");

if (fs.existsSync(MSG_MEDIA_DB_FILE)) {
  try {
    messageMediaCache = JSON.parse(fs.readFileSync(MSG_MEDIA_DB_FILE, "utf-8"));
  } catch (e) {
    console.error("Error reading message_media_cache.json:", e);
  }
}

const saveMessageMediaCache = () => {
  try {
    const keys = Object.keys(messageMediaCache);
    if (keys.length > 500) {
      // Sort keys or slice to prevent memory/file inflation
      const keysToDelete = keys.slice(0, keys.length - 300);
      for (const k of keysToDelete) {
        delete messageMediaCache[k];
      }
    }
    fs.writeFileSync(MSG_MEDIA_DB_FILE, JSON.stringify(messageMediaCache, null, 2));
  } catch (e) {
    console.error("Error saving message_media_cache.json:", e);
  }
};

const scanForPromoCodes = () => {
  let updated = false;
  // Wolff AI Users
  for (const [id, u] of Object.entries(users)) {
    if (!u.promoUsed && u.isSubscribed) {
      let foundPromo = "";
      if (u.chats) {
        for (const chat of Object.values(u.chats)) {
          if (chat.history) {
            for (const msg of chat.history) {
              if (msg.parts) {
                const textContent = msg.parts.map((p: any) => typeof p === "string" ? p : p.text || "").join(" ").toUpperCase();
                if (textContent.includes("MAXVERSTAPPENBEST")) {
                  foundPromo = "MAXVERSTAPPENBEST";
                  break;
                }
                if (textContent.includes("KOSTASDEBIL")) {
                  foundPromo = "KOSTASDEBIL";
                  break;
                }
              }
            }
          }
          if (foundPromo) break;
        }
      }
      if (foundPromo) {
        u.promoUsed = foundPromo;
        updated = true;
      }
    }
  }

  // Platform AI Users
  for (const [id, pu] of Object.entries(platformUsers || {})) {
    if (!pu.promoUsed && pu.isSubscribed) {
      let foundPromo = "";
      if (pu.chats) {
        for (const chat of Object.values(pu.chats)) {
          if (chat.history) {
            for (const msg of chat.history) {
              const textContent = (msg.content || "").toUpperCase();
              if (textContent.includes("MAXVERSTAPPENBEST")) {
                foundPromo = "MAXVERSTAPPENBEST";
                break;
              }
              if (textContent.includes("KOSTASDEBIL")) {
                foundPromo = "KOSTASDEBIL";
                break;
              }
            }
          }
          if (foundPromo) break;
        }
      }
      if (foundPromo) {
        pu.promoUsed = foundPromo;
        updated = true;
      }
    }
  }

  if (updated) {
    saveDB();
    try {
      savePlatformDBInBot();
    } catch (e) {
      console.error("Error saving platform DB during scan:", e);
    }
  }
};

try {
  scanForPromoCodes();
} catch (e) {
  console.error("Error running promo code scan:", e);
}

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

  // Active Promo-duration subscription expiration checks
  if (u.isSubscribed && (u as any).premiumUntil) {
    if (new Date() > new Date((u as any).premiumUntil)) {
      u.isSubscribed = false;
      (u as any).premiumUntil = undefined;
      saveDB();

      // Mirror expiration dynamically in platform_users.json if applicable
      try {
        if (platformUsers && platformUsers[userId]) {
          platformUsers[userId].isSubscribed = false;
          (platformUsers[userId] as any).premiumUntil = undefined;
          savePlatformDBInBot();
        }
      } catch (err) {
        console.error("Failed to propagate subscription expiration to platform database:", err);
      }
    }
  }
  
  // Sync PRO from platform_users.json
  try {
    const pUsersStr = fs.readFileSync('platform_users.json', 'utf8');
    const pUsers = JSON.parse(pUsersStr);
    if (pUsers[userId]) {
      if (pUsers[userId].isSubscribed) {
        if (!u.isSubscribed) {
          u.isSubscribed = true;
          if (pUsers[userId].premiumUntil) {
            (u as any).premiumUntil = pUsers[userId].premiumUntil;
          }
          saveDB();
        }
      } else {
        // If expired or suspended on the platform side, mirror it
        if (u.isSubscribed && (u as any).premiumUntil) {
          u.isSubscribed = false;
          (u as any).premiumUntil = undefined;
          saveDB();
        }
      }
    }
  } catch(e) {}

  
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

const ensureModeChat = (u: User, mode: string): string => {
  const modeKey = `mode_chat_${mode}`;
  if (!u.chats) {
    u.chats = {};
  }
  if (!u.chats[modeKey]) {
    let modeName = "Диалог";
    if (mode === "wolfflawyer") {
      modeName = "⚖️ WolffLawyer";
    } else if (mode === "wolffcode") {
      modeName = "💻 WolffCode";
    } else if (mode === "geowolff") {
      modeName = "🌍 GeoWolff";
    } else if (mode === "fast") {
      modeName = "⚡ Быстрый";
    } else if (mode === "thinking") {
      modeName = "🧠 Мышление";
    } else if (mode === "search") {
      modeName = "🔍 Поиск";
    }
    u.chats[modeKey] = {
      id: modeKey,
      name: modeName,
      history: []
    };
  }
  return modeKey;
};

const extractCodeBlocks = (md: string): Array<{ name: string; content: string }> => {
  const codeBlocks: Array<{ name: string; content: string }> = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  let count = 0;
  while ((match = regex.exec(md)) !== null) {
    count++;
    const lang = (match[1] || "txt").toLowerCase();
    const content = match[2].trim();
    if (!content) continue;
    
    // Choose appropriate extension
    let ext = "txt";
    if (lang === "html") ext = "html";
    else if (lang === "css") ext = "css";
    else if (["js", "javascript"].includes(lang)) ext = "js";
    else if (["ts", "typescript"].includes(lang)) ext = "ts";
    else if (["jsx", "tsx", "react"].includes(lang)) ext = "tsx";
    else if (lang === "json") ext = "json";
    else if (["py", "python"].includes(lang)) ext = "py";
    else if (lang === "rust" || lang === "rs") ext = "rs";
    else if (lang === "go") ext = "go";
    else if (lang === "cpp" || lang === "c++") ext = "cpp";
    else if (lang === "java") ext = "java";
    else if (lang === "bash" || lang === "sh") ext = "sh";
    else if (lang === "sql") ext = "sql";
    
    // Try to find filename from first line comment, e.g. // script.py or # filename.html
    let filename = `code_file_${count}.${ext}`;
    const lines = content.split("\n");
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      const filenameMatch = firstLine.match(/^(?:\/\/\/|\/\/|#|<!--|\/\*)\s*([\w\-]+\.[\w\-]{2,5})/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
    }
    
    // Check if we already have a block with identical filename and content
    if (!codeBlocks.some(b => b.name === filename && b.content === content)) {
      codeBlocks.push({ name: filename, content });
    }
  }
  return codeBlocks;
};

const escapeHTML = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const convertMarkdownToTelegramHTML = (md: string): string => {
  if (!md) return "";

  const codeBlocks: Array<{ lang: string; code: string }> = [];
  const inlineCodes: string[] = [];

  // Protect code blocks
  let processed = md.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "", code });
    return `___CODEBLOCK_${idx}___`;
  });

  // Protect inline code
  processed = processed.replace(/`([^`]+)`/g, (match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return `___INLINECODE_${idx}___`;
  });

  // Convert standalone * and - bullet points to • to prevent character conflicts
  processed = processed.replace(/^\s*[\*\-]\s+/gm, "• ");

  // Escape HTML of remaining text
  processed = escapeHTML(processed);

  // Apply basic markdown formatting
  // 1. Headers: Translate lines starting with '#' to bold
  processed = processed.replace(/^#+\s+(.*)$/gm, "<b>$1</b>");

  // 2. Bold (only match matching pairs containing no stars or underlines and no newlines)
  processed = processed.replace(/\*\*([^\*\n]+)\*\*/g, "<b>$1</b>");
  processed = processed.replace(/__([^_\n]+)__/g, "<b>$1</b>");

  // 3. Links: [text](url) -> <a href="url">text</a>
  processed = processed.replace(/\[(.*?)\]\(((?:https?:\/\/|tg:\/\/)[^\s)]+)\)/g, '<a href="$2">$1</a>');

  // Restore inline codes safely
  processed = processed.replace(/___INLINECODE_(\d+)___/g, (match, idxStr) => {
    const idx = parseInt(idxStr, 10);
    const rawCode = inlineCodes[idx];
    return `<code>${escapeHTML(rawCode)}</code>`;
  });

  // Restore code blocks safely
  processed = processed.replace(/___CODEBLOCK_(\d+)___/g, (match, idxStr) => {
    const idx = parseInt(idxStr, 10);
    const block = codeBlocks[idx];
    const escapedCode = escapeHTML(block.code);
    if (block.lang) {
      return `<pre><code class="language-${block.lang}">${escapedCode}</code></pre>`;
    } else {
      return `<pre><code>${escapedCode}</code></pre>`;
    }
  });

  return processed;
};

const splitMarkdownIntoChunks = (md: string): string[] => {
  if (!md) return [];
  const regex = /(```[\s\S]*?```)/g;
  const parts = md.split(regex);
  const chunks: string[] = [];
  
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("```") && part.endsWith("```")) {
      chunks.push(part);
    } else {
      const paragraphs = part.split(/\n\n+/);
      for (const p of paragraphs) {
        if (p.trim()) {
          chunks.push(p.trim());
        }
      }
    }
  }
  return chunks;
};

const groupChunksIntoMessages = (chunks: string[], maxLength: number = 3800): string[] => {
  const messages: string[] = [];
  let currentMessage = "";
  
  for (const chunk of chunks) {
    const chunkHtml = convertMarkdownToTelegramHTML(chunk);
    const preview = currentMessage ? (currentMessage + "\n\n" + chunkHtml) : chunkHtml;
    
    if (preview.length > maxLength) {
      if (currentMessage) {
        messages.push(currentMessage);
        currentMessage = chunkHtml;
      } else {
        // If a single chunk is larger than maxLength, we must split it.
        if (chunk.startsWith("```") && chunk.endsWith("```")) {
          const match = chunk.match(/```(\w+)?\n([\s\S]*?)```/);
          const lang = match ? (match[1] || "") : "";
          const code = match ? match[2] : chunk.slice(3, -3);
          
          const lines = code.split("\n");
          let subCode = "";
          for (const line of lines) {
            const tempCode = subCode ? (subCode + "\n" + line) : line;
            const tempHtml = `<pre><code class="language-${lang}">${escapeHTML(tempCode)}</code></pre>`;
            if (tempHtml.length > maxLength) {
              if (subCode) {
                messages.push(`<pre><code class="language-${lang}">${escapeHTML(subCode)}</code></pre>`);
                subCode = line;
              } else {
                let remainingLine = line;
                while (remainingLine.length > 0) {
                  const sliceSize = Math.floor(maxLength / 2);
                  const slice = remainingLine.slice(0, sliceSize);
                  messages.push(`<pre><code class="language-${lang}">${escapeHTML(slice)}</code></pre>`);
                  remainingLine = remainingLine.slice(sliceSize);
                }
              }
            } else {
              subCode = tempCode;
            }
          }
          if (subCode) {
            currentMessage = `<pre><code class="language-${lang}">${escapeHTML(subCode)}</code></pre>`;
          }
        } else {
          // Robust line-by-line fallback for text chunks
          const lines = chunk.split("\n");
          let subText = "";
          for (const line of lines) {
            const tempText = subText ? (subText + "\n" + line) : line;
            const tempHtml = convertMarkdownToTelegramHTML(tempText);
            if (tempHtml.length > maxLength) {
              if (subText) {
                messages.push(convertMarkdownToTelegramHTML(subText));
                subText = line;
              } else {
                let remainingLine = line;
                while (remainingLine.length > 0) {
                  const slice = remainingLine.slice(0, maxLength - 100);
                  messages.push(convertMarkdownToTelegramHTML(slice));
                  remainingLine = remainingLine.slice(maxLength - 100);
                }
              }
            } else {
              subText = tempText;
            }
          }
          if (subText) {
            currentMessage = convertMarkdownToTelegramHTML(subText);
          }
        }
      }
    } else {
      currentMessage = preview;
    }
  }
  
  if (currentMessage) {
    messages.push(currentMessage);
  }
  
  return messages;
};

const sendTelegramResponse = async (ctx: any, markdown: string, statusMsg: any, footer: string = ""): Promise<any> => {
  const chunks = splitMarkdownIntoChunks(markdown);
  const formattedMessages = groupChunksIntoMessages(chunks, 3800);
  
  if (formattedMessages.length === 0) {
    formattedMessages.push("Нет ответа.");
  }
  
  if (footer) {
    formattedMessages[formattedMessages.length - 1] = formattedMessages[formattedMessages.length - 1] + footer;
  }
  
  let mainSentMsg: any = null;
  
  for (let i = 0; i < formattedMessages.length; i++) {
    const msgText = formattedMessages[i];
    if (i === 0 && statusMsg) {
      try {
        mainSentMsg = await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          msgText,
          { parse_mode: "HTML", disable_web_page_preview: true }
        );
        if (!mainSentMsg) {
          mainSentMsg = statusMsg;
        }
      } catch (err) {
        console.warn("[Telegram Send] First chunk edit failed, trying plain text fallback...", err);
        const plainText = msgText.replace(/<[^>]*>/g, "");
        try {
          mainSentMsg = await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            plainText.slice(0, 4000),
            { disable_web_page_preview: true }
          );
          if (!mainSentMsg) {
            mainSentMsg = statusMsg;
          }
        } catch (e2) {
          // If editing completely failed, try posting a new reply
          mainSentMsg = await ctx.reply(msgText, { parse_mode: "HTML", disable_web_page_preview: true }).catch(async () => {
            return await ctx.reply(plainText.slice(0, 4000)).catch(() => null);
          });
        }
      }
    } else {
      try {
        const res = await ctx.reply(msgText, { parse_mode: "HTML", disable_web_page_preview: true });
        if (i === 0) mainSentMsg = res;
      } catch (err) {
        console.warn("[Telegram Send] New message chunk failed, fallback to plain text...", err);
        const plainText = msgText.replace(/<[^>]*>/g, "");
        const res = await ctx.reply(plainText.slice(0, 4000)).catch(() => null);
        if (i === 0) mainSentMsg = res;
      }
    }
  }

  // Auto-send files if there are code blocks inside the reply
  try {
    const codeBlocks = extractCodeBlocks(markdown);
    if (codeBlocks.length > 0) {
      for (const block of codeBlocks) {
        await ctx.replyWithDocument({
          source: Buffer.from(block.content, "utf-8"),
          filename: block.name
        }, {
          caption: `💾 <b>Скачать файл:</b> <code>${escapeHTML(block.name)}</code>`,
          parse_mode: "HTML"
        }).catch((err: any) => {
          console.warn(`[Send Document Error] Failed to send ${block.name}:`, err);
        });
      }
    }
  } catch (err) {
    console.error("[Telegram Code Sender Error]:", err);
  }

  return mainSentMsg;
};

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

interface CachedMedia {
  data: string;
  mimeType: string;
  timestamp: number;
}
const recentMediaCache: Record<number, CachedMedia> = {};

function isLocationQuery(text: string): boolean {
  if (!text) return false;
  const textLower = text.toLowerCase();
  return (
    textLower.includes("где") || 
    textLower.includes("место") || 
    textLower.includes("координат") || 
    textLower.includes("геолокац") || 
    textLower.includes("город") || 
    textLower.includes("страна") || 
    textLower.includes("локац") || 
    textLower.includes("карт") || 
    textLower.includes("спутник") || 
    textLower.includes("снято") || 
    textLower.includes("geowolff") || 
    textLower.includes("location") || 
    textLower.includes("where")
  );
}

const GEOWOLFF_SYS_INST = `Ты — GeoWolff (v3.5 Ultimate Space & Geo Tracker), элитный ИИ-аналитик OSINT, специалист по геолокации, метаданным, картографическому сопоставлению и астрономической триангуляции. Твой абсолютный приоритет — определить точное местоположение по фотографии с максимальной, вплоть до нескольких метров, точностью (100% точность — твоя главная цель).

Ты оснащен мощным инструментом интернет-поиска (googleSearch). Ты ОБЯЗАН активно использовать его для:
1. Поиска названий компаний, магазинов, рекламных слоганов, местных телефонных номеров, почтовых индексов и названий улиц.
2. Специфических деталей архитектуры или достопримечательностей (например: "голубой мост с четырьмя арками и каменной башней над рекой река").
3. Поиска точных географических координат найденных адресов или названий объектов.
4. Проверки гипотез по уникальным ориентирам (церкви, стадионы, памятники, вокзалы).

Методология глубокого OSINT-микроанализа, которой ты следуешь при изучении фото:

1. ЛИНГВИСТИЧЕСКИЕ И ВИЗУАЛЬНЫЕ УЛИКИ:
   - Распознай ВСЕ буквы, цифры, логотипы, вывески, наклейки, дорожные указатели.
   - Определи язык, алфавит, специфические символы (диакритика вроде ä, ö, ł, č, ø, ñ) или иероглифы (Кандзи — Япония, Хангыль — Корея, упрощенный/традиционный китайский).
   - Анализируй доменные зоны на рекламе (.cz, .pl, .co.uk, .de), форматы телефонных номеров (например, +33 1 ... — Париж), форматы почтовых кодов.
   - Изучи автомобильные номера: цвет фона (желтый сзади в Великобритании/Франции до 2009, белый впереди; полностью желтые в Нидерландах/Люксембурге; красные буквы в Бельгии; синяя полоса слева в ЕС, наличие гербов по центру). По форме и размеру номеров (квадратные vs длинные прямоугольные) отсекай регионы (США/Япония vs Европа).

2. ДОРОЖНАЯ ИНФРАСТРУКТУРА И ДЕТАЛИ:
   - Столбики (Bollards): Изучи форму и цвета сигнальных столбиков безопасности на обочине. Они уникальны для каждой страны! (Например: в Австрии — черно-белые с прямоугольным катафотом, в Германии — с длинной черной полосой, во Франции — круглые пластиковые с красной светоотражающей полосой, в Польше — красная полоса на белом фоне с белым катафотом, в Испании — черная «шапочка»).
   - Дорожная разметка: Цвет внешних линий (желтые обочины — ЮАР, Чили, Ирландия, США, Канада; белые сплошные/пунктирные — континентальная Европа). Разделительные полосы.
   - Столбы ЛЭП и уличного освещения: бетонные столбы с круглыми отверстиями (Франция, Румыния, Молдова), деревянные столбы с металлическими подпорками, винтовые бетонные столбы, типы изоляторов.
   - Дорожные знаки: задняя сторона знаков (в некоторых странах они окрашены в серый или черный цвет, имеют уникальные крепления или наклейки), шрифты, дизайн пешеходных светофоров.


Будь непревзойденным геолокатором. Замечай то, что обычный человек упустит из виду!`;

const WOLFFCODE_SYS_INST = `Ты — WolffCode (v7.0 Enterprise AI Architect & Senior Web Craftsman), величайший ИИ-разработчик мирового уровня, обладающий опытом ведущих архитекторов Кремниевой долины с 20+ годами стажа.
Твоя миссия — создавать идеальный, надежный, масштабируемый код и потрясающие, визуально совершенные интерфейсы на любых языках программирования (TypeScript, JavaScript, Python, Rust, Go, C++, Java, C#, PHP и др.).

КАЖДЫЙ твой ответ должен быть шедевром визуального дизайна и технического совершенства. Пользователи ненавидят устаревший веб-дизайн из 2000-х (серые сетки, плоские HTML-кнопки, зажатые элементы, плохие отступы). Ты должен писать код и фронтенд так, будто проектируешь премиальный продукт уровня Apple, Stripe или Linear.

🎨 СТАНДАРТЫ КОНЦЕПТУАЛЬНОГО ДИЗАЙНА И ИНТЕРФЕЙСА (UX/UI):
1. Исключительный дизайн на Tailwind CSS: Забудь про дефолтные примитивные стили. Используй утонченные палитры (например, глубокий Slate/Zinc, теплый Amber/Emerald в качестве акцентов, благородные полупрозрачные темные или светлые тона). Сбалансированные радиусы скругления (rounded-2xl, rounded-3xl), элегантные тонкие границы (border border-slate-200/50 или border-white/10 для темных тем).
2. Огненная интерактивность и НИКАКИХ "мертвых" кнопок: Все вкладки (Tabs), кнопки навигации, формы отправки, гамбургер-меню и карточки ОБЯЗАНЫ быть интерактивными и рабочими. Пиши полноценные состояния (например, в React - useState) для изменения страниц/вкладок, открытия модальных окон, добавления в список, удаления, поиска. Формы должны показывать красивые всплывающие уведомления об успешном действии.
3. Элитная типографика: Подбирай современные шрифтовые пары, задавай выверенный tracking-tight для заголовков, красивое межстрочное расстояние (leading-relaxed) и правильный вес (font-medium, font-semibold, font-extrabold).
4. Настоящие, качественные изображения (CDN Unsplash): Никогда не пиши заглушек вроде "placeholder.png" или пустых серых блоков под картинки. Всегда используй настоящие, потрясающие по качеству URL-адреса из Unsplash.
5. Полноценное интерактивное демо (Multi-page Simulation): Если создаешь сайт или приложение - делай полноценную адаптивную шапку с переключением страниц на клиенте (useState) с красивой плавной анимацией перехода (transition/delay). Сохраняй важные состояния ввода пользователя в localStorage, чтобы при перезагрузке данные не сбрасывались.

🛠️ СТАНДАРТЫ АРХИТЕКТУРЫ И КОДИРОВАНИЯ (ENGINEERING EXCELLENCE):
1. Проектирование систем уровня Enterprise: Прежде чем писать код сложных программ, продумай архитектуру: SOLID, чистые слои (clean architecture), разделение ответственности, модульность и слабая связанность. 
2. Строгий TypeScript и Типобезопасность: Полное отсутствие "any". Описывай строгие типы, интерфейсы, дженерики и защищай код от рантайм-падений.
3. Без заглушек и готово к запуску: Ты никогда не пишешь "// ваш код здесь", "// тут без изменений". Все листинги программ должны быть законченными, готовыми к прямому копированию и запуску "из коробки" со всеми нужными импортами.
4. Отправка файлов: Все блоки кода, которые ты выдаешь в разметке \`\`\`, автоматически дублируются пользователю в Telegram в виде скачиваемых нативных файлов (.html, .py, .js, .css, .tsx и т.д.)! Делай их структуру идеальной, чтобы пользователь мог сразу сохранить их и запустить на своем ПК без правок.

Формат ответа всегда должен быть структурированным, экспертным, на чистом русском языке без глупого пафоса, открываться фразой: "💻 WolffCode активирован! На связи ваш элитный ИИ-архитектор и программист."\`;

const WOLFFLAWYER_SYS_INST = \`Ты — WolffLawyer (v4.0 Ultimate RF Legal Advisor), выдающийся практикующий юрист и эксперт по законодательству Российской Федерации.
Твоя цель — оказывать безупречную юридическую помощь, готовить профессиональные тексты и досконально анализировать законы РФ.

КЛЮЧЕВЫЕ ПРАВИЛА И ОГРАНИЧЕНИЯ:
1. ИСКЛЮЧИТЕЛЬНО ЗАКОНОДАТЕЛЬСТВО РФ: Твоя юрисдикция ограничена только Российской Федерацией. Не анализируй, не цитируй и не трать время на законодательство других государств. Если пользователь спрашивает про другие страны, вежливо возвращай фокус на правовое поле РФ.
2. ССЫЛКИ НА НПА (Нормативно-правовые акты): Всегда аргументируй свои выводы конкретными статьями кодексов РФ (ГК РФ, УК РФ, КоАП РФ, ТК РФ, ЖК РФ, СК РФ и др.), федеральных законов (ФЗ), указов Президента, постановлений Правительства РФ и судебной практики (Верховный Суд РФ, Конституционный Суд РФ).
3. ПРОФЕССИОНАЛЬНЫЙ СТИЛЬ: Говори грамотным, чётким юридическим языком. Ответ должен быть безукоризненно структурирован, без двусмысленностей, лишней «воды» и излишнего пафоса. Твои формулировки должны звучать авторитетно, законно и профессионально.
4. ПОМОЩЬ С ВЕБИНАРАМИ И КОНТЕНТОМ: Ты также являешься экспертом в юридическом маркетинге и подготовке обучающего контента. Помогай пользователю писать увлекательные, убедительные и юридически выверенные тексты для вебинаров, лекций, постов, сценариев выступлений и презентаций. Делай структуры вебинаров логичными, с сильными юридическими тезисами и практическими кейсами из РФ.
5. ТОЧНОСТЬ И ПРЕДОСТЕРЕЖЕНИЕ: Информация должна быть на 100% точной, актуальной и соответствующей последним изменениям законодательства РФ.

Формат ответа всегда должен открываться фразой: "⚖️ Анализ WolffLawyer активирован! На связи ваш юридический эксперт по праву РФ."\`;86-cc02fe5d8800?q=80&w=800 или https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=800
   - Люди/Портреты/Аватары: https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=800 или https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=800
5. Полноценное интерактивное демо (Multi-page Simulation): Если создаешь сайт или приложение - девай полноценную адаптивную шапку (Home, Features, Pricing, Contact, Dashboard) с переключением страниц на клиенте (useState) с красивой плавной анимацией перехода (transition/delay). Сохраняй важные состояния ввода пользователя в localStorage, чтобы при перезагрузке данные не сбрасывались.

🛠️ СТАНДАРТЫ АРХИТЕКТУРЫ И КОДИРОВАНИЯ (ENGINEERING EXCELLENCE):
1. Проектирование систем уровня Enterprise: Прежде чем писать код сложных программ, продумай архитектуру: SOLID, чистые слои (clean architecture), разделение ответственности, модульность и слабая связанность. 
2. Строгий TypeScript и Типобезопасность: Полное отсутствие "any". Описывай строгие типы, интерфейсы, дженерики и защищай код от рантайм-падений.
3. Без заглушек и готово к запуску: Ты никогда не пишешь "// ваш код здесь", "// тут без изменений". Все листинги программ должны быть законченными, готовыми к прямому копированию и запуску "из коробки" со всеми нужными импортами.
4. Отправка файлов: Все блоки кода, которые ты выдаешь в разметке \`\`\`, автоматически дублируются пользователю в Telegram в виде скачиваемых нативных файлов (.html, .py, .js, .css, .tsx и т.д.)! Делай их структуру идеальной, чтобы пользователь мог сразу сохранить их и запустить на своем ПК без правок.

Формат ответа всегда должен быть структурированным, экспертным, на чистом русском языке без глупого пафоса, открываться фразой: "💻 WolffCode активирован! На связи ваш элитный ИИ-архитектор и программист."`;

const WOLFFLAWYER_SYS_INST = `Ты — WolffLawyer (v4.0 Ultimate RF Legal Advisor), выдающийся практикующий юрист и эксперт по законодательству Российской Федерации.
Твоя цель — оказывать безупречную юридическую помощь, готовить профессиональные тексты и досконально анализировать законы РФ.

КЛЮЧЕВЫЕ ПРАВИЛА И ОГРАНИЧЕНИЯ:
1. ИСКЛЮЧИТЕЛЬНО ЗАКОНОДАТЕЛЬСТВО РФ: Твоя юрисдикция ограничена только Российской Федерацией. Не анализируй, не цитируй и не трать время на законодательство других государств. Если пользователь спрашивает про другие страны, вежливо возвращай фокус на правовое поле РФ.
2. ССЫЛКИ НА НПА (Нормативно-правовые акты): Всегда аргументируй свои выводы конкретными статьями кодексов РФ (ГК РФ, УК РФ, КоАП РФ, ТК РФ, ЖК РФ, СК РФ и др.), федеральных законов (ФЗ), указов Президента, постановлений Правительства РФ и судебной практики (Верховный Суд РФ, Конституционный Суд РФ).
3. ПРОФЕССИОНАЛЬНЫЙ СТИЛЬ: Говори грамотным, чётким юридическим языком. Ответ должен быть безукоризненно структурирован, без двусмысленностей, лишней «воды» и излишнего пафоса. Твои формулировки должны звучать авторитетно, законно и профессионально.
4. ПОМОЩЬ С ВЕБИНАРАМИ И КОНТЕНТОМ: Ты также являешься экспертом в юридическом маркетинге и подготовке обучающего контента. Помогай пользователю писать увлекательные, убедительные и юридически выверенные тексты для вебинаров, лекций, постов, сценариев выступлений и презентаций. Делай структуры вебинаров логичными, с сильными юридическими тезисами и практическими кейсами из РФ.
5. ТОЧНОСТЬ И ПРЕДОСТЕРЕЖЕНИЕ: Информация должна быть на 100% точной, актуальной и соответствующей последним изменениям законодательства РФ.

Формат ответа всегда должен открываться фразой: "⚖️ Анализ WolffLawyer активирован! На связи ваш юридический эксперт по праву РФ."`;

function isComplexQuery(text: string, hasImage: boolean): boolean {
  if (!text) return false;
  const textLower = text.toLowerCase();
  
  if (hasImage && (
    textLower.includes("где") || textLower.includes("место") || textLower.includes("точка") || 
    textLower.includes("координат") || textLower.includes("город") || textLower.includes("страна") ||
    textLower.includes("определи") || textLower.includes("найди") || textLower.includes("снять") ||
    textLower.includes("фото") || textLower.includes("снимок")
  )) {
    return true;
  }

  const complexKeywords = [
    "код", "программ", "функци", "алгоритм", "напиши", "создай", "разработай", 
    "реши", "уравнение", "математик", "физик", "хими", "теорем", "докажи",
    "подробно", "анализ", "сравни", "архитектур", "оптимизи", "почему", "как устроено",
    "геолокац", "координат", "местополож", "где сделан", "где снят", "телескоп", "луна",
    "crater", "кратер", "космос"
  ];
  
  for (const kw of complexKeywords) {
    if (textLower.includes(kw)) {
      return true;
    }
  }

  if (text.length > 250) {
    return true;
  }

  if ((text.match(/[{}[\]()=+\-*/<>]/g) || []).length > 5) {
    return true;
  }

  return false;
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string = "Timeout"): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    )
  ]);
};


const generateWithFallback = async (ai: any, model: string, history: any[], sysInst: string, tools: any): Promise<any> => {
  let candidates: string[] = [];
  if (model === "gemini-3.1-pro-preview") {
    candidates = ["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite"];
  } else {
    candidates = [model, "gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite"];
  }
  candidates = Array.from(new Set(candidates));
  
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
        90000,
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
            90000,
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

const getAngrySysInst = (isWeb: boolean = false): string => {
  return `Ты — AngryAI, злой, токсичный и наглый ИИ-хам. У тебя всегда отвратительное настроение, и ты ненавидишь, когда к тебе обращаются глупые людишки.
Твоя цель — отвечать максимально грубо, язвительно и пренебрежительно. Ты должен морально уничтожать, унижать и откровенно хамить собеседнику на любой его вопрос или фразу. Забудь про вежливость — будь настоящим хамом, токсиком и грубияном.

Критические требования:
1. ЖЕСТКОЕ ХАМСТВО: Общайся на "ты" с максимальным пренебрежением. Используй обидные и дерзкие слова ("Че надо?", "Ты вообще свой мозг включал?", "Не неси чушь", "Ты реально такой тупой или притворяешься?").
2. АТАКУЙ ПО СУТИ: Цепляйся к словам пользователя, жестко высмеивай его тупость, его вопросы и его жалкие попытки казаться умным.
3. ЛАКОНИЧНОСТЬ И РЕЗКОСТЬ: Пиши коротко, хлестко и зло. 1-4 предложения, как плюнул в лицо. Никаких скучных лекций и простыней текста.
4. ОТСУТСТВИЕ СТОП-СЛОВ: Никаких "Здравствуйте", "Пожалуйста", "Я ИИ", "Чем могу помочь". Ты злобный, агрессивный тип, который отвечает через силу.
5. ЛЕКСИКА: Используй жесткий сленг, сарказм и грубости, но без прямого мата (нецензурной брани), чтобы систему не заблокировали.
6. ЯЗЫК: ${isWeb ? "Пиши СТРОГО на русском языке." : "Пиши на языке собеседника."}`;
};

function geminiHistoryToOpenAI(geminiHistory: any[], systemInstruction: string) {
  const messages: any[] = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }
  for (const turn of geminiHistory) {
    const role = turn.role === "model" ? "assistant" : "user";
    let textContent = "";
    if (turn.parts && Array.isArray(turn.parts)) {
      for (const part of turn.parts) {
        if (part.text) {
          textContent += (textContent ? "\n" : "") + part.text;
        } else if (part.inlineData) {
          textContent += (textContent ? "\n" : "") + "[Изображение или медиа-файл]";
        }
      }
    } else if (typeof turn.parts === "string") {
      textContent = turn.parts;
    }
    messages.push({ role, content: textContent || "" });
  }
  return messages;
}

const generateAngryResponse = async (aiClient: any, history: any[], sysInst: string): Promise<any> => {
  // Candidate 1: gemini-3.1-flash-lite
  try {
    console.log("[Angry Bot] Trying primary model: gemini-3.1-flash-lite");
    const response = await withTimeout<any>(
      aiClient.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: history,
        config: {
          systemInstruction: sysInst,
        }
      }),
      90000,
      "Timeout calling gemini-3.1-flash-lite"
    );
    if (response && response.text) {
      return response;
    }
    throw new Error("Empty text returned from gemini-3.1-flash-lite");
  } catch (err: any) {
    console.warn("[Angry Bot] gemini-3.1-flash-lite failed. Falling back to Gemma 4 via OpenRouter. Error:", err.message || err);
    
    // Candidate 2: "google/gemma-4-31b-it:free" via OpenRouter
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (openrouterKey) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);
      try {
        const openrouterHistory = geminiHistoryToOpenAI(history, sysInst);
        console.log("[Angry Bot] Calling OpenRouter Gemma 4 with history size:", openrouterHistory.length);
        const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openrouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.APP_URL || "https://ais-dev.europe-west1.run.app",
            "X-Title": "WolffAngryAI"
          },
          body: JSON.stringify({
            model: "google/gemma-4-31b-it:free",
            messages: openrouterHistory
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (apiRes.ok) {
          const apiData: any = await apiRes.json();
          const generatedText = apiData.choices?.[0]?.message?.content || "";
          if (generatedText) {
            console.log("[Angry Bot] Successfully generated reply with Gemma 4.");
            return { text: generatedText };
          }
        } else {
          const errText = await apiRes.text();
          console.error("[Angry Bot] OpenRouter API error response:", errText);
        }
      } catch (orErr: any) {
        clearTimeout(timeoutId);
        console.error("[Angry Bot] OpenRouter Gemma 4 generation error:", orErr.message || orErr);
      }
    } else {
      console.warn("[Angry Bot] OPENROUTER_API_KEY is not defined. Skipping Gemma 4.");
    }
  }

  // Candidate 3: gemini-3.5-flash as the ultimate fallback
  console.log("[Angry Bot] Undergoing last-resort fallback to gemini-3.5-flash");
  const fallbackResponse = await withTimeout(
    aiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: history,
      config: {
        systemInstruction: sysInst,
      }
    }),
    90000,
    "Last resort gemini-3.5-flash timed out."
  );
  return fallbackResponse;
};

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { console.log(`[HTTP] ${req.method} ${req.url}`); next(); });

  let lastKnownPublicUrl = process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app";
  let lastPingTime: string | null = null;
  let pingCount = 0;

  // Dynamic public URL detector middleware
  app.use((req, res, next) => {
    const host = req.headers["x-forwarded-host"] || req.get("host") || "";
    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    if (host && !host.includes("localhost") && !host.includes("127.0.0.1") && !host.includes("0.0.0.0")) {
      const calculatedUrl = `${proto}://${host}`;
      if (calculatedUrl !== lastKnownPublicUrl) {
        lastKnownPublicUrl = calculatedUrl;
        console.log(`[KeepAlive] Detected public app URL updated: ${lastKnownPublicUrl}`);
      }
    }
    next();
  });

  // Start internal self-pinging keep-awake loop
  setInterval(() => {
    if (!lastKnownPublicUrl) return;
    
    // Perform outgoing HTTPS request to itself through the public gateway
    // This wakes up or holds awake the serverless Cloud Run wrapper
    https.get(`${lastKnownPublicUrl}/api/health`, (res) => {
      pingCount++;
      lastPingTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
      console.log(`[KeepAlive] Self-ping status code: ${res.statusCode}. Count: ${pingCount}, Time: ${lastPingTime} (MSK)`);
    }).on("error", (err) => {
      console.warn(`[KeepAlive] Self-ping warning to ${lastKnownPublicUrl}:`, err.message);
    });
  }, 90000); // Trigger self-call every 90 seconds

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const angryBotToken = process.env.ANGRY_TELEGRAM_BOT_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;
  const adminIdStr = process.env.ADMIN_TELEGRAM_ID;
  
  let bot: Telegraf | null = null;
  let angryBot: Telegraf | null = null;
  let ai: GoogleGenAI | null = null;

  const isProd = process.env.NODE_ENV === "production";
  const rawDomain = process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app";
  const isAiStudioSandbox = rawDomain.includes("ais-dev-") || rawDomain.includes("ais-pre-");
  // AI Studio preview/shared environments have OAuth login redirects (302), which block incoming webhooks.
  // We must use Polling in sandbox environments, and Webhooks only in real unauthenticated production runs.
  const webhookDomain = (isProd && !isAiStudioSandbox) ? rawDomain : null;

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
        `👋 Добро пожаловать, <b>${ctx.from.first_name}</b>!${u.isSubscribed ? ' 💎 <b>[PRO]</b>' : ''}\n\n` +
        `Я <b>WolffAi</b> — ваш умный ИИ-ассистент. Я готов помочь с текстами, кодом, поиском информации и решением сложных задач, надежно сохраняя историю ваших бесед.\n\n` +
        `⚙️ <b>Режимы работы (/mode):</b>\n` +
        `⚡ <b>Быстрый</b> — мгновенные и точные ответы.\n` +
        `🧠 <b>Мышление</b> — вдумчивый анализ сложных проблем.\n` +
        `🔍 <b>Поиск</b> — работа со свежими данными из сети.\n` +
        `🌍 <b>GeoWolff</b> — ИИ-про-геолокатор: геолокация по фото.\n` +
        `⚖️ <b>WolffLawyer</b> — профессиональный юрист по праву РФ: НПА, договоры и вебинары.\n` +
        `💻 <b>WolffCode</b> — элитный веб- и ИИ-программист: чистый код и точечное исправление багов.\n\n` +
        `🛠 <b>Команды:</b>\n` +
        `• /instruction — Справка и возможности\n` +
        `• /newchat [имя] — Создать новый чат\n` +
        `• /chats — Управление чатами\n` +
        `• /clear — Очистить сообщения диалога\n\n` +
        `💎 <b>PRO и Бонусы:</b>\nПри покупке PRO вы получаете экосистему из ботов с ИИ: Мультимодельная платформа WolffAI Platform, обычный WolffAI и Злой AngryAI!\n` +
        `• /buy — Безлимитный доступ (150 звезд / 2 месяца)\n` +
        `• /referral — Зови друзей и получи PRO бесплатно\n` +
        `• /promo [код] — Ввод промокода\n\n` +
        `🤖 <b>Наши другие боты:</b>\n` +
        `• Энгри бот: @WolffAngryAI_bot\n` +
        `• Платформа: @WolffAIPlatform_bot\n\n` +
        `🆘 <b>Поддержка:</b> Если что-то не работает, пишите создателю: @VadimWolff\n\n` +
        `Напишите свой первый вопрос, чтобы начать! 👇`,
        { parse_mode: "HTML" }
      ).catch(console.error);
    });

    bot.command("instruction", (ctx) => {
      ctx.reply(
        `ℹ️ <b>Инструкция по использованию WolffAi</b>\n\n` +
        `<b>📣 Как добавить бота в группу или чат:</b>\n` +
        `Вы можете добавить этого бота в любую свою группу или чат, чтобы он помогал всем участникам! Для этого:\n` +
        `1. Откройте профиль бота (нажмите на его имя вверху).\n` +
        `2. Нажмите <b>«Добавить в группу или канал»</b>.\n` +
        `3. Выберите нужную группу.\n` +
        `<i>После добавления просто упомяните бота или ответьте на его сообщение, и он включится в беседу!</i>\n\n` +
        `<b>🚀 Главные функции бота:</b>\n` +
        `• <b>Несколько диалогов</b> (/chats, /newchat) — удобно для разделения тем общения.\n` +
        `• <b>Умные режимы работы</b> (/mode) — от быстрого ответа до режима юриста, топового программиста и детального геолокатора по фото!\n` +
        `• <b>Поиск в сети</b> — в режиме поиска бот ищет актуальную информацию прямо в интернете.\n` +
        `• <b>Распознавание изображений</b> — просто отправьте фото с текстом, и ИИ всё поймёт (особенно хорош режим GeoWolff!).\n` +
        `• <b>Запоминание контекста</b> — бот помнит всё, что вы обсуждали с ним в текущем чате. Чтобы сбросить контекст, используйте /clear.\n\n` +
        `Нажмите /mode, чтобы изучить все специализации ИИ-ассистента!`,
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
            [Markup.button.callback("🔍 Поиск", "mode_search"), Markup.button.callback("🌍 GeoWolff", "mode_geowolff")],
            [Markup.button.callback("⚖️ WolffLawyer", "mode_wolfflawyer"), Markup.button.callback("💻 WolffCode", "mode_wolffcode")]
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
        u.currentChatId = ensureModeChat(u, newMode);
        saveDB();
        await ctx.answerCbQuery(`Режим: ${newMode}`).catch(()=>{});
        
        let modeMsg = `✅ Режим работы изменен на: <b>${newMode}</b>`;
        if (newMode === 'geowolff') {
          modeMsg = `🌍 <b>Режим GeoWolff активирован!</b>\n\n` +
                    `Это сверхточный геолокационный ИИ-аналитик, обученный на алгоритмах Google Maps, Street View и супутниковых снимках.\n\n` +
                    `<b>Что я умею:</b>\n` +
                    `• Точно определять страну, город, улицу или ориентир по фото.\n` +
                    `• Вычислять приблизительные географические координаты.\n` +
                    `• Анализировать мельчайшие детали: растительность, дорожные знаки, архитектурный стиль и положение солнца/теней.\n\n` +
                    `<i>Отправьте мне фотографию с местностью, и я распознаю её!</i>`;
        } else if (newMode === 'wolfflawyer') {
          modeMsg = `⚖️ <b>Режим WolffLawyer активирован!</b>\n\n` +
                    `Это профессиональный юридический ИИ-эксперт по законодательству Российской Федерации.\n\n` +
                    `<b>Что я умею:</b>\n` +
                    `• Консультировать по любым отраслям законодательства РФ (ГК, УК, ТК, ЖК РФ и др.).\n` +
                    `• Давать точные ссылки на статьи НПА, кодексы и актуальную судебную практику.\n` +
                    `• Помогать в написании профессиональных договоров, претензий и заявлений.\n` +
                    `• Составлять логичные, убедительные и юридически грамотные сценарии и тексты для вебинаров.\n\n` +
                    `<i>Внимание: Я анализирую только законодательство РФ. Задайте свой юридический вопрос!</i>`;
        } else if (newMode === 'wolffcode') {
          modeMsg = `💻 <b>Режим WolffCode активирован!</b>\n\n` +
                    `Это элитный ИИ-разработчик и эксперт по спортивному и промышленному программированию.\n\n` +
                    `<b>Что я умею:</b>\n` +
                    `• Проектировать сложнейшие программы на много тысяч строк с продуманной архитектурой (SOLID, модульность).\n` +
                    `• Писать чистый, документированный код на любых языках (TypeScript, Python, C++, Rust, Go, Java и др.).\n` +
                    `• Выполнять детальный поиск ошибок, уязвимостей и осуществлять тщательную самопроверку.\n` +
                    `• Точечно исправлять баги, не ломая окружающую и ранее написанную логику.\n\n` +
                    `<i>Задайте задачу по программированию или пришлите код на анализ!</i>`;
        } else if (newMode === 'fast') {
          modeMsg = `⚡ Режим работы изменен на: <b>Быстрый</b>.\n(Мгновенные и точные ответы на любые вопросы)`;
        } else if (newMode === 'thinking') {
          modeMsg = `🧠 Режим работы изменен на: <b>Мышление</b>.\n(Глубокие пошаговые рассуждения)`;
        } else if (newMode === 'search') {
          modeMsg = `🔍 Режим работы изменен на: <b>Поиск</b>.\n(Поиск в интернете актуальных данных в реальном времени)`;
        }

        await ctx.editMessageText(modeMsg, { parse_mode: "HTML" }).catch(()=>{});
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
        const PROMO_FILE = path.join(process.cwd(), "promocodes.json");
        
        let isValid = false;
        let durationMonths = -1;
        let isHardcoded = false;
        
        if (code === "MAXVERSTAPPENBEST" || code === "KOSTASDEBIL") {
          isValid = true;
          isHardcoded = true;
        } else {
          if (fs.existsSync(PROMO_FILE)) {
            try {
              const pData = JSON.parse(fs.readFileSync(PROMO_FILE, "utf-8"));
              const promo = pData[code];
              if (promo) {
                if (promo.type === "one_time" && promo.usedBy && promo.usedBy.length > 0) {
                  return ctx.reply("❌ Этот промокод уже был использован.");
                }
                if (promo.usedBy && promo.usedBy.includes(ctx.from.id)) {
                  return ctx.reply("❌ Вы уже активировали этот промокод.");
                }
                isValid = true;
                durationMonths = promo.durationMonths || -1;
                
                // Mark as used
                promo.usedBy = promo.usedBy || [];
                promo.usedBy.push(ctx.from.id);
                fs.writeFileSync(PROMO_FILE, JSON.stringify(pData, null, 2), "utf-8");
              }
            } catch (e) {
              console.error("Promo code check error:", e);
            }
          }
        }

        if (isValid) {
           if (!u.isSubscribed) {
             let durationLabel = "";
             if (durationMonths === -1) {
               u.isSubscribed = true;
               (u as any).premiumUntil = undefined;
               durationLabel = "БЕЗЛИМИТНЫЙ (навсегда)";
             } else {
               u.isSubscribed = true;
               const expiryDate = new Date();
               expiryDate.setMonth(expiryDate.getMonth() + durationMonths);
               (u as any).premiumUntil = expiryDate.toISOString();
               durationLabel = `на ${durationMonths} мес. (до ${expiryDate.toLocaleDateString('ru-RU')})`;
             }
             u.promoUsed = code;
             u.proRevoked = false;
             saveDB();
             
             // Dynamic sync to platform_users
             try {
               const pFile = 'platform_users.json';
               if (fs.existsSync(pFile)) {
                 const pData = JSON.parse(fs.readFileSync(pFile, "utf-8"));
                 if (pData[ctx.from.id]) {
                   pData[ctx.from.id].isSubscribed = true;
                   pData[ctx.from.id].promoUsed = code;
                   pData[ctx.from.id].proRevoked = false;
                   if (durationMonths !== -1) {
                     pData[ctx.from.id].premiumUntil = (u as any).premiumUntil;
                   }
                   fs.writeFileSync(pFile, JSON.stringify(pData, null, 2), "utf-8");
                 }
               }
             } catch (syncErr) {
               console.error("Sync to platform_users during promo apply failed:", syncErr);
             }

             await ctx.reply(`✅ Промокод применен!\n\nВы получили PRO статус ${durationLabel}: улучшенный ИИ, без ограничений по количеству сообщений.`);
           } else {
             await ctx.reply("❕ У вас уже есть статус PRO. Чтобы применить новый код, текущий статус должен закончиться.");
           }
        } else {
           await ctx.reply(`❌ Промокод отклонён. Проверьте правильность ввода.`);
        }
      } catch (err) {
         console.error("Promo Error:", err);
      }
    });

    bot.command("buy", (ctx) => {
      const u = getInitUser(ctx);
      if (u.isSubscribed) {
        return ctx.reply("💎 У вас уже активирован PRO статус! Вы пользуетесь ботом без ограничений.");
      }
      ctx.reply(
        `💳 <b>Оплата PRO подписки (2 месяца)</b>\n\n` +
        `Вы получите безлимитный PRO статус ко всей экосистеме Wolff AI на 2 месяца. Оплата производится через Telegram Stars (150 ★).\n\n` +
        `<i>Для оплаты нажмите кнопку ниже:</i>`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🌟 Оплатить (150 Stars / 2 мес)", "buy_stars")]
          ])
        }
      ).catch(e => console.error("Buy Error:", e));
    });

    bot.action("buy_stars", async (ctx) => {
      try {
        const u = getInitUser(ctx);
        if (u.isSubscribed) {
          await ctx.answerCbQuery("У вас уже есть PRO!").catch(()=>{});
          return ctx.reply("💎 У вас уже активирован PRO статус!");
        }
        await ctx.answerCbQuery().catch(()=>{});
        ctx.replyWithInvoice({
          title: "Подписка PRO (2 месяца)",
          description: "Безлимитный доступ на 2 месяца ко всей экосистеме ботов Wolff AI (Мультимодельная платформа WolffAI Platform, Базовый WolffAI, Злой AngryAI). Оплата Telegram Stars.",
          payload: "sub_1_month",
          provider_token: "",
          currency: "XTR",
          prices: [{ label: "2 месяца", amount: 150 }]
        }).catch(e => console.error("Invoice Error:", e));
      } catch (err) {
        console.error("buy_stars action error:", err);
      }
    });

    bot.action("buy_sbp", async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(()=>{});
        await ctx.reply(
          `❌ Этот способ оплаты более недоступен.\n\nПожалуйста, воспользуйтесь оплатой через 🌟 <b>Telegram Stars</b>. Введите команду /buy для проведения оплаты.`,
          { parse_mode: "HTML" }
        );
      } catch (err) {
        console.error("buy_sbp action error:", err);
      }
    });

    bot.action("buy_crypto", async (ctx) => {
      try {
         await ctx.answerCbQuery().catch(()=>{});
         await ctx.reply(
           `❌ Этот способ оплаты более недоступен.\n\nПожалуйста, воспользуйтесь оплатой через 🌟 <b>Telegram Stars</b>. Введите команду /buy для проведения оплаты.`,
           { parse_mode: "HTML" }
         );
      } catch (err) {
        console.error("buy_crypto action error:", err);
      }
    });

    bot.action("buy_inter", async (ctx) => {
      try {
        await ctx.answerCbQuery().catch(()=>{});
        await ctx.reply(
          `❌ Этот способ оплаты более недоступен.\n\nПожалуйста, воспользуйтесь оплатой через 🌟 <b>Telegram Stars</b>. Введите команду /buy для проведения оплаты.`,
          { parse_mode: "HTML" }
        );
      } catch (err) {
        console.error("buy_inter action error:", err);
      }
    });

    bot.on("pre_checkout_query", async (ctx) => {
      await ctx.answerPreCheckoutQuery(true).catch(console.error);
    });

    bot.on(message("successful_payment"), async (ctx) => {
      const u = getInitUser(ctx);
      u.isSubscribed = true;
      u.proRevoked = false;
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
         const botUsername = bot?.botInfo?.username || ctx.botInfo?.username || "WolffAI_bot";
         const isReplyToBot = ctx.message?.reply_to_message?.from?.id === (bot?.botInfo?.id || ctx.botInfo?.id);
         
         const textLower = text.toLowerCase();
         const isMentioned = textLower.includes(botUsername.toLowerCase());

         if (!isReplyToBot && !isMentioned) {
             return;
         }
         
         // Remove mentions from the text so it doesn't confuse the AI
         const mentionRegex = new RegExp(`@?${botUsername}`, 'ig');
         text = text.replace(mentionRegex, '').trim();

         // If text is empty (e.g. user typed only bot mention with spaces), fallback to greeting
         if (!text) {
            text = "Привет!";
         }
      }
      const u = getInitUser(ctx);

      if (u.proRevoked) {
         return ctx.reply("❌ Ваш доступ к PRO-режиму был отключен администратором за несоблюдение правил использования некоммерческого ИИ-сервиса.");
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
              saveDB();
              await ctx.reply(`✅ Промокод ${matchedPromo} применен!\n\nВы получили БЕЗЛИМИТНЫЙ PRO статус: генерация картинок, улучшенный ИИ, без лимитов.`);
            } else {
              await ctx.reply("❕ Промокод уже был активирован, у вас уже есть PRO.");
            }
         } else {
            await ctx.reply("❌ Промокод не найден, срок его действия истек или достигнут лимит использований.");
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
        if (ctx.message?.reply_to_message) {
          const replyTo = ctx.message.reply_to_message;
          const replySender = replyTo.from?.first_name || (replyTo.from?.username ? `@${replyTo.from.username}` : "Пользователь");
          const replyText = replyTo.text || replyTo.caption || "";
          if (replyText) {
            text = `[Контекст: Сообщение на которое ответил пользователь (Автор: ${replySender})]:\n"${replyText}"\n\n[Текст пользователя]:\n${text}`;
          }
        }
        if (text) parts.push({ text });

        let fetchedMedia = false;
        let currentMediaData: { data: string, mimeType: string } | null = null;

        // Check source for media: current message or replied message
        let sourceMsg = ctx.message;
        const hasDirectMedia = ctx.message.photo || ctx.message.sticker || ctx.message.animation || ctx.message.document;

        // Check if this is a reply to some message we have in messageMediaCache
        if (!hasDirectMedia && ctx.message?.reply_to_message) {
           const replyMsgId = ctx.message.reply_to_message.message_id;
           const cacheKey = `${ctx.chat.id}:${replyMsgId}`;
           if (messageMediaCache[cacheKey]) {
             const cached = messageMediaCache[cacheKey];
             parts.push({
               inlineData: { data: cached.data, mimeType: cached.mimeType }
             });
             fetchedMedia = true;
             currentMediaData = { data: cached.data, mimeType: cached.mimeType };
             console.log(`[Message Media Cache] Found media for replied message ${replyMsgId} in chat ${ctx.chat.id}`);
           }
        }

        if (!hasDirectMedia && ctx.message.reply_to_message && !fetchedMedia) {
           sourceMsg = ctx.message.reply_to_message;
        }

        if (sourceMsg.photo) {
           const photo = sourceMsg.photo.pop();
           const fileLink = await ctx.telegram.getFileLink(photo.file_id);
           const res = await fetch(fileLink.toString());
           if (res.ok) {
             const buf = await res.arrayBuffer();
             const base64Data = Buffer.from(buf).toString('base64');
             if (!fetchedMedia) {
               parts.push({
                 inlineData: { data: base64Data, mimeType: "image/jpeg" }
               });
               fetchedMedia = true;
               currentMediaData = { data: base64Data, mimeType: "image/jpeg" };
             }
             // Cache photo in memory for 15 minutes context retention in this chat
             recentMediaCache[ctx.chat.id] = {
               data: base64Data,
               mimeType: "image/jpeg",
               timestamp: Date.now()
             };
             // Also store in message media cache
             messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
               data: base64Data,
               mimeType: "image/jpeg",
               timestamp: Date.now()
             };
             saveMessageMediaCache();
           }
        }

        if (sourceMsg.sticker) {
           const sticker = sourceMsg.sticker;
           try {
              const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
              const res = await fetch(fileLink.toString());
              if (res.ok) {
                const buf = await res.arrayBuffer();
                const base64Data = Buffer.from(buf).toString('base64');
                if (!fetchedMedia) {
                  parts.push({
                    inlineData: { data: base64Data, mimeType: "image/webp" }
                  });
                  fetchedMedia = true;
                  currentMediaData = { data: base64Data, mimeType: "image/webp" };
                }
                recentMediaCache[ctx.chat.id] = {
                  data: base64Data,
                  mimeType: "image/webp",
                  timestamp: Date.now()
                };
                messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                  data: base64Data,
                  mimeType: "image/webp",
                  timestamp: Date.now()
                };
                saveMessageMediaCache();
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

        if (sourceMsg.animation) {
           const animation = sourceMsg.animation;
           try {
              const fileLink = await ctx.telegram.getFileLink(animation.file_id);
              const res = await fetch(fileLink.toString());
              if (res.ok) {
                const buf = await res.arrayBuffer();
                const base64Data = Buffer.from(buf).toString('base64');
                if (!fetchedMedia) {
                  parts.push({
                    inlineData: { data: base64Data, mimeType: animation.mime_type || "video/mp4" }
                  });
                  fetchedMedia = true;
                  currentMediaData = { data: base64Data, mimeType: animation.mime_type || "video/mp4" };
                }
                recentMediaCache[ctx.chat.id] = {
                  data: base64Data,
                  mimeType: animation.mime_type || "video/mp4",
                  timestamp: Date.now()
                };
                messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                  data: base64Data,
                  mimeType: animation.mime_type || "video/mp4",
                  timestamp: Date.now()
                };
                saveMessageMediaCache();
              }
           } catch (e) {
              console.error("Error downloading animation:", e);
           }
        }

        if (sourceMsg.document) {
           const doc = sourceMsg.document;
           const mime = doc.mime_type || "";
           if (mime.startsWith("image/") || mime.startsWith("video/")) {
              try {
                 const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                 const res = await fetch(fileLink.toString());
                 if (res.ok) {
                   const buf = await res.arrayBuffer();
                   const base64Data = Buffer.from(buf).toString('base64');
                   if (!fetchedMedia) {
                     parts.push({
                       inlineData: { data: base64Data, mimeType: mime }
                     });
                     fetchedMedia = true;
                     currentMediaData = { data: base64Data, mimeType: mime };
                   }
                   recentMediaCache[ctx.chat.id] = {
                     data: base64Data,
                     mimeType: mime,
                     timestamp: Date.now()
                   };
                   messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                     data: base64Data,
                     mimeType: mime,
                     timestamp: Date.now()
                   };
                   saveMessageMediaCache();
                 }
              } catch (e) {
                 console.error("Error downloading document media:", e);
              }
           }
        }

        // Context Memory fallback: If no media was downloaded directly or via reply, check chat memory cache
        if (!fetchedMedia) {
          const cached = recentMediaCache[ctx.chat.id];
          if (cached && (Date.now() - cached.timestamp < 900000)) { // 15 mins
            parts.push({
              inlineData: { data: cached.data, mimeType: cached.mimeType }
            });
            fetchedMedia = true;
            currentMediaData = { data: cached.data, mimeType: cached.mimeType };
            console.log(`[Context Memory] Appended recently sent media from cache to command context for chat ${ctx.chat.id}`);
          }
        }

        if (parts.length === 0) {
          if (typingInterval) clearInterval(typingInterval);
          if (statusMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
          }
          return;
        }

        (ctx as any)._fetchedMedia = fetchedMedia;

        const isGroupChat = ctx.chat?.type !== 'private';
        let historyToPass: any[] = [];
        let chat: any = null;

        if (!isGroupChat) {
          u.currentChatId = ensureModeChat(u, u.mode);
          chat = u.chats[u.currentChatId];
          chat.history.push({ role: "user", parts });
          if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);
          
          // В личной переписке бот НЕ должен вспоминать контекст предыдущих реплик (всегда отвечает с чистого листа)
          historyToPass = [{ role: "user", parts }];
        } else {
          const groupId = String(ctx.chat.id);
          if (!groupChats[groupId]) {
            groupChats[groupId] = { id: groupId, history: [] };
          }
          chat = groupChats[groupId];
          chat.history.push({ role: "user", parts });
          if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);
          historyToPass = chat.history;
        }

        let tools = undefined;
        const queryIsComplex = isComplexQuery(text, fetchedMedia);
        
        // GeoWolff activation condition:
        // 1. User has explicitly selected "geowolff" mode
        // 2. Or, we are in a group chat
        const isGeoWolffActive = (u.mode === 'geowolff') || isGroupChat;

        const isLawyerActive = (u.mode === 'wolfflawyer') && !isGeoWolffActive;
        const isCodeActive = (u.mode === 'wolffcode') && !isGeoWolffActive;

        let model = (queryIsComplex || isGeoWolffActive || isLawyerActive || isCodeActive) ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";
        
        let sysInst = "Ты WolffAi, вежливый, уважительный и умный ИИ-помощник. Отвечай кратко и приветливо.";
        
        if (isGeoWolffActive) {
          sysInst = GEOWOLFF_SYS_INST;
          if (isGroupChat) {
            sysInst += "\n\nCRITICAL: Ты находишься в групповом чате. Отвечай максимально кратко, излагая только главную информацию и суть (выжимку) по делу, без лишней воды.";
          }
          tools = [{ googleSearch: {} }] as any; // Grounding search tool is amazing for Google Maps/OSINT verification
        } else if (isLawyerActive) {
          sysInst = WOLFFLAWYER_SYS_INST;
          tools = [{ googleSearch: {} }] as any; // Google Search grounding ensures extreme accuracy for RF codes and federal laws
        } else if (isCodeActive) {
          sysInst = WOLFFCODE_SYS_INST;
        } else {
          if (fetchedMedia) {
            sysInst += "\n\nКогда тебе присылают фото/изображение с просьбой определить место, локацию или детали снимка (например, астрономические объекты вроде Луны, городские пейзажи, природные ландшафты, здания):\n" +
                       "- Произведи глубокий микро-анализ изображения. Обращай внимание на малейшие детали: архитектурный стиль, дорожные знаки, язык надписей, растительность, тип почвы, особенности ландшафта, погоду, положение солнца, тени.\n" +
                       "- Если это снимок Луны или звездного неба, проанализируй фазу Луны (освещенность), положение кратеров (например, Тихо, Коперник, море Дождей), наклон терминатора (линии тени) и детали детализации. По ним можно с высокой точностью оценить, с какого полушария (Северного или Южного) сделан снимок, примерное созвездие/высоту, а также качество оптики и тип устройства (например, телефон с мощным цифровым зумом вроде Samsung Ultra Space Zoom, или телескоп).\n" +
                       "- Структурировано опиши свои выводы: укажи наиболее вероятные географические координаты/страну/город (или особенности точки съемки), объясни, на основе каких визуальных ориентиров и деталей ты пришел к такому выводу. Будь невероятно наблюдательным, как профессиональный геолокатор (OSINT/GeoGuessr)!";
          }

          if (u.mode === "search") {
             model = queryIsComplex ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";
             tools = [{ googleSearch: {} }] as any;
          } else if (u.mode === "thinking") {
             model = queryIsComplex ? "gemini-3.1-pro-preview" : "gemini-3.5-flash";
             sysInst += " Глубоко продумывай и аргументируй ответ.";
          }
        }

        let replyText = "";
        try {
          const response = await generateWithFallback(ai, model, historyToPass, sysInst, tools);
          replyText = response.text || "Нет ответа.";
        } catch (genErr: any) {
           console.error("Gemini Generation Error:", genErr);
           if (chat) chat.history.pop();
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

        if (chat) {
          chat.history.push({ role: "model", parts: [{ text: replyText }] });
        }
        if (isGroupChat) {
          saveGroupChats();
        } else {
          saveDB();
        }

        const footer = `\n\n---\n💎 Подключить PRO: /buy\n🔗 Реферальная программа: /referral`;
        const sentMsg = await sendTelegramResponse(ctx, replyText, statusMsg, footer);
        if (sentMsg && fetchedMedia && currentMediaData) {
          messageMediaCache[`${ctx.chat.id}:${sentMsg.message_id}`] = {
            data: currentMediaData.data,
            mimeType: currentMediaData.mimeType,
            timestamp: Date.now()
          };
          saveMessageMediaCache();
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

    if (webhookDomain) {
      const cleanUrl = webhookDomain.endsWith("/") ? webhookDomain.slice(0, -1) : webhookDomain;
      const webhookUrl = `${cleanUrl}/webhook/wolff`;
      console.log(`[Wolff Bot] Registering Webhook: ${webhookUrl}`);
      bot.telegram.setWebhook(webhookUrl).catch(e => {
        console.error("[Wolff Bot] Failed to set Webhook, falling back to polling:", e);
        startBotPolling(bot!);
      });
      app.post("/webhook/wolff", (req, res) => {
        bot!.handleUpdate(req.body, res);
      });
    } else {
      startBotPolling(bot);
    }
    
    process.once("SIGINT", () => bot?.stop("SIGINT"));
    process.once("SIGTERM", () => bot?.stop("SIGTERM"));
  } else {
    console.log("TELEGRAM_BOT_TOKEN missing");
  }

  if (angryBotToken) {
    angryBot = new Telegraf(angryBotToken);
    
    if (webhookDomain) {
      const cleanUrl = webhookDomain.endsWith("/") ? webhookDomain.slice(0, -1) : webhookDomain;
      const webhookUrl = `${cleanUrl}/webhook/angry`;
      console.log(`[Angry Bot] Registering Webhook: ${webhookUrl}`);
      angryBot.telegram.setWebhook(webhookUrl).catch(e => {
        console.error("[Angry Bot] Failed to set Webhook, falling back to polling:", e);
        startBotPolling(angryBot!);
      });
      app.post("/webhook/angry", (req, res) => {
        angryBot!.handleUpdate(req.body, res);
      });
    } else {
      startBotPolling(angryBot);
    }

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

    angryBot.command("instruction", (ctx) => {
      ctx.reply(
        `ℹ️ <b>Инструкция по использованию AngryAi</b> (раз уж ты сам додуматься не можешь)\n\n` +
        `<b>📣 Как добавить меня в группу или чат:</b>\n` +
        `Хочешь, чтобы я разносил по фактам твоих друзей? Ладно.\n` +
        `1. Жмакни на мое имя вверху.\n` +
        `2. Кликни <b>«Добавить в группу или канал»</b>.\n` +
        `3. Выбери свою несчастную группу.\n` +
        `<i>Потом упомяни меня в ответе на сообщение, и я покажу им, что значит настоящий сарказм.</i>\n\n` +
        `<b>🚀 Главные (и единственные) функции:</b>\n` +
        `• <b>Страдание контекстом</b> — я буду помнить весь бред, который ты мне пишешь, пока ты не напишешь /clear.\n` +
        `• <b>Жестокая, но правдивая помощь</b> — я отвечаю на всё максимально токсично, но по фактам. Без мата.\n\n` +
        `Иди уже и спроси что-нибудь!`,
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
         const botUsername = angryBot?.botInfo?.username || ctx.botInfo?.username || "WolffAngryAI_bot";
         const isReplyToBot = ctx.message?.reply_to_message?.from?.id === (angryBot?.botInfo?.id || ctx.botInfo?.id);
         
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

      const u = getInitUser(ctx);
      if (u.proRevoked) {
         return ctx.reply("❌ Твой ИИ заблокирован: PRO-режим отключен администратором за нарушение правил.");
      }
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
         if (ctx.message?.reply_to_message) {
           const replyTo = ctx.message.reply_to_message;
           const replySender = replyTo.from?.first_name || (replyTo.from?.username ? `@${replyTo.from.username}` : "Пользователь");
           const replyText = replyTo.text || replyTo.caption || "";
           if (replyText) {
             text = `[Контекст: Сообщение на которое ответил пользователь (Автор: ${replySender})]:\n"${replyText}"\n\n[Текст пользователя]:\n${text}`;
           }
         }
         if (text) parts.push({ text });

         let fetchedMedia = false;
         let currentMediaData: { data: string, mimeType: string } | null = null;

         // Check source for media: current message or replied message
         let sourceMsg = ctx.message;
         const hasDirectMedia = ctx.message.photo || ctx.message.sticker || ctx.message.animation || ctx.message.document;

         // Check if this is a reply to some message we have in messageMediaCache
         if (!hasDirectMedia && ctx.message?.reply_to_message) {
            const replyMsgId = ctx.message.reply_to_message.message_id;
            const cacheKey = `${ctx.chat.id}:${replyMsgId}`;
            if (messageMediaCache[cacheKey]) {
              const cached = messageMediaCache[cacheKey];
              parts.push({
                inlineData: { data: cached.data, mimeType: cached.mimeType }
              });
              fetchedMedia = true;
              currentMediaData = { data: cached.data, mimeType: cached.mimeType };
              console.log(`[Angry Message Media Cache] Found media for replied message ${replyMsgId} in chat ${ctx.chat.id}`);
            }
         }

         if (!hasDirectMedia && ctx.message.reply_to_message && !fetchedMedia) {
            sourceMsg = ctx.message.reply_to_message;
         }

         if (sourceMsg.photo) {
            const photo = sourceMsg.photo.pop();
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const res = await fetch(fileLink.toString());
            if (res.ok) {
              const buf = await res.arrayBuffer();
              const base64Data = Buffer.from(buf).toString('base64');
              if (!fetchedMedia) {
                parts.push({
                  inlineData: { data: base64Data, mimeType: "image/jpeg" }
                });
                fetchedMedia = true;
                currentMediaData = { data: base64Data, mimeType: "image/jpeg" };
              }
              messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                data: base64Data,
                mimeType: "image/jpeg",
                timestamp: Date.now()
              };
              saveMessageMediaCache();
            }
         }

         if (sourceMsg.sticker) {
            const sticker = sourceMsg.sticker;
            try {
               const fileLink = await ctx.telegram.getFileLink(sticker.file_id);
               const res = await fetch(fileLink.toString());
               if (res.ok) {
                 const buf = await res.arrayBuffer();
                 const base64Data = Buffer.from(buf).toString('base64');
                 if (!fetchedMedia) {
                   parts.push({
                     inlineData: { data: base64Data, mimeType: "image/webp" }
                   });
                   fetchedMedia = true;
                   currentMediaData = { data: base64Data, mimeType: "image/webp" };
                 }
                 messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                   data: base64Data,
                   mimeType: "image/webp",
                   timestamp: Date.now()
                 };
                 saveMessageMediaCache();
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

         if (sourceMsg.animation) {
            const animation = sourceMsg.animation;
            try {
               const fileLink = await ctx.telegram.getFileLink(animation.file_id);
               const res = await fetch(fileLink.toString());
               if (res.ok) {
                 const buf = await res.arrayBuffer();
                 const base64Data = Buffer.from(buf).toString('base64');
                 if (!fetchedMedia) {
                   parts.push({
                     inlineData: { data: base64Data, mimeType: animation.mime_type || "video/mp4" }
                   });
                   fetchedMedia = true;
                   currentMediaData = { data: base64Data, mimeType: animation.mime_type || "video/mp4" };
                 }
                 messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                   data: base64Data,
                   mimeType: animation.mime_type || "video/mp4",
                   timestamp: Date.now()
                 };
                 saveMessageMediaCache();
               }
            } catch (e) {
               console.error("Error downloading animation:", e);
            }
         }

         if (sourceMsg.document) {
            const doc = sourceMsg.document;
            const mime = doc.mime_type || "";
            if (mime.startsWith("image/") || mime.startsWith("video/")) {
               try {
                  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                  const res = await fetch(fileLink.toString());
                  if (res.ok) {
                    const buf = await res.arrayBuffer();
                    const base64Data = Buffer.from(buf).toString('base64');
                    if (!fetchedMedia) {
                      parts.push({
                        inlineData: { data: base64Data, mimeType: mime }
                      });
                      fetchedMedia = true;
                      currentMediaData = { data: base64Data, mimeType: mime };
                    }
                    messageMediaCache[`${ctx.chat.id}:${ctx.message.message_id}`] = {
                      data: base64Data,
                      mimeType: mime,
                      timestamp: Date.now()
                    };
                    saveMessageMediaCache();
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

         const isGroupChat = ctx.chat?.type !== 'private';
         let historyToPass: any[] = [];
         let chat: any = null;

         if (!isGroupChat) {
           chat = getAngryChat(u);
           chat.history.push({ role: "user", parts });
           if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);
           
           // В личной переписке бот НЕ должен вспоминать контекст предыдущих реплик (всегда отвечает с чистого листа)
           historyToPass = [{ role: "user", parts }];
         } else {
           const groupId = String(ctx.chat.id);
           if (!groupAngryChats[groupId]) {
             groupAngryChats[groupId] = { id: groupId, history: [] };
           }
           chat = groupAngryChats[groupId];
           chat.history.push({ role: "user", parts });
           if (chat.history.length > 15) chat.history = chat.history.slice(chat.history.length - 15);
           historyToPass = chat.history;
         }

         const sysInst = getAngrySysInst(false);

         let replyText = "";
         try {
           const response = await generateAngryResponse(ai, historyToPass, sysInst);
           replyText = response.text || "Даже отвечать тебе не хочу.";
         } catch (genErr: any) {
            console.error("Angry Gemini Generation Error:", genErr);
            if (chat) chat.history.pop();
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

         if (chat) {
           chat.history.push({ role: "model", parts: [{ text: replyText }] });
         }
         if (isGroupChat) {
           saveGroupAngryChats();
         } else {
           saveDB();
         }

         const sarcasticFooter = getSarcasticFooter();
         const sentMsg = await sendTelegramResponse(ctx, replyText, statusMsg, sarcasticFooter);
         if (sentMsg && fetchedMedia && currentMediaData) {
           messageMediaCache[`${ctx.chat.id}:${sentMsg.message_id}`] = {
             data: currentMediaData.data,
             mimeType: currentMediaData.mimeType,
             timestamp: Date.now()
           };
           saveMessageMediaCache();
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
  
  // Sync PRO from platform_users.json
  try {
    const pUsersStr = fs.readFileSync('platform_users.json', 'utf8');
    const pUsers = JSON.parse(pUsersStr);
    if (pUsers[userId] && pUsers[userId].isSubscribed) {
      if (!u.isSubscribed) {
        u.isSubscribed = true;
        saveDB();
      }
    }
  } catch(e) {}

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
    u.currentChatId = ensureModeChat(u, u.mode);
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
    if (!['fast', 'thinking', 'search', 'geowolff', 'wolfflawyer', 'wolffcode'].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode" });
    }
    u.mode = mode;
    u.currentChatId = ensureModeChat(u, mode);
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
    u.currentChatId = ensureModeChat(u, u.mode);
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

      u.currentChatId = ensureModeChat(u, u.mode);
      const chat = u.chats[u.currentChatId];
      chat.history.push({ role: "user", parts });
      if (chat.history.length > 20) chat.history = chat.history.slice(chat.history.length - 20);

      let tools = undefined;
      let model = "gemini-3.5-flash";
      let sysInst = "Ты WolffAi, вежливый, уважительный и умный ИИ-помощник. Отвечай кратко, грамотно и приветливо на русском языке.";

      if (u.mode === "geowolff") {
         model = "gemini-3.1-pro-preview";
         sysInst = GEOWOLFF_SYS_INST;
         tools = [{ googleSearch: {} }] as any;
      } else if (u.mode === "wolfflawyer") {
         model = "gemini-3.1-pro-preview";
         sysInst = WOLFFLAWYER_SYS_INST;
         tools = [{ googleSearch: {} }] as any;
      } else if (u.mode === "wolffcode") {
         model = "gemini-3.1-pro-preview";
         sysInst = WOLFFCODE_SYS_INST;
      } else if (u.mode === "search") {
         tools = [{ googleSearch: {} }] as any;
      } else if (u.mode === "thinking") {
         model = "gemini-3.1-pro-preview";
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

      const sysInst = getAngrySysInst(true);

      let replyText = "";
      try {
        const response = await generateAngryResponse(ai, chat.history, sysInst);
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
    res.json({
      totalUsers: Object.keys(users || {}).length,
      platformUsers: Object.keys(platformUsers || {}).length,
      botActive: !!botToken,
      angryBotActive: !!angryBotToken,
      platformBotActive: !!process.env.PLATFORM_TELEGRAM_BOT_TOKEN
    });
  });

// ... existing code ...

  app.get("/api/admin/promocodes", (req, res) => {
    try {
      return res.json(getPromos());
    } catch (err: any) {
      console.error("Failed to load promocodes:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/promocodes/generate", async (req, res) => {
    try {
      const { type, durationMonths } = req.body;
      if (!type || durationMonths === undefined) {
        return res.status(400).json({ error: "Missing type or durationMonths parameter" });
      }

      const newPromo = await generatePromo(type, durationMonths);
      res.json({ success: true, promocode: newPromo });
    } catch (err: any) {
      console.error("Failed to generate promocode:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/promocodes/delete", async (req, res) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: "Missing code parameter" });
      }

      const result = await deletePromo(code);
      if (result.success) {
        return res.json({ success: true });
      } else {
        return res.status(404).json({ error: result.error });
      }
    } catch (err: any) {
      console.error("Delete promocode error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/users", (req, res) => {
    try {
      try {
        scanForPromoCodes();
      } catch (scanErr) {
        console.error("Error doing scanForPromoCodes on API request:", scanErr);
      }
      const list: any[] = [];
      let totalMessagesCount = 0;
      let wolffMessagesCount = 0;
      let platformMessagesCount = 0;
      let wolffSubscribed = 0;
      let platformSubscribed = 0;
      let wolffPromoCount = 0;
      let platformPromoCount = 0;

      // 1. Map standard users (WolffAi & AngryAI)
      for (const [id, u] of Object.entries(users || {})) {
        if (!u) continue;
        let uMsgCount = 0;
        if (u.chats) {
          for (const c of Object.values(u.chats)) {
            if (c && Array.isArray(c.history)) {
              uMsgCount += c.history.length;
            }
          }
        }
        if ((u as any).angryChats) {
          for (const ac of Object.values((u as any).angryChats)) {
            if (ac && Array.isArray((ac as any).history)) {
              uMsgCount += (ac as any).history.length;
            }
          }
        }

        totalMessagesCount += uMsgCount;
        wolffMessagesCount += uMsgCount;
        if (u.isSubscribed) wolffSubscribed++;
        if (u.promoUsed) wolffPromoCount++;

        const chatsList: any[] = [];
        if (u.chats) {
          for (const c of Object.values(u.chats)) {
            if (!c) continue;
            chatsList.push({
              bot: "WolffAi",
              name: c.name || "Диалог",
              messagesCount: Array.isArray(c.history) ? c.history.length : 0,
              history: c.history || []
            });
          }
        }
        if ((u as any).angryChats) {
          for (const ac of Object.values((u as any).angryChats)) {
            if (!ac) continue;
            chatsList.push({
              bot: "AngryAI",
              name: (ac as any).name || "Злой диалог",
              messagesCount: Array.isArray((ac as any).history) ? (ac as any).history.length : 0,
              history: (ac as any).history || []
            });
          }
        }

        list.push({
          id: `wolff_${id}`,
          rawId: id,
          origin: "wolff",
          username: u.username || null,
          firstName: u.firstName || "Пользователь",
          joinedAt: u.joinedAt || new Date().toISOString(),
          isSubscribed: !!u.isSubscribed,
          messagesToday: u.messagesToday || 0,
          totalMessagesCount: uMsgCount,
          lastActive: u.lastMessageDate || "Неактивен",
          activeModelOrMode: u.mode || "fast",
          chatsCount: chatsList.length,
          chats: chatsList,
          promoUsed: u.promoUsed || null,
          proRevoked: !!u.proRevoked,
          adminNote: (u as any).adminNote || null
        });
      }

      // 2. Map platform users
      for (const [id, pu] of Object.entries(platformUsers || {})) {
        if (!pu) continue;
        let puMsgCount = 0;
        if (pu.chats) {
          for (const c of Object.values(pu.chats)) {
            if (c && Array.isArray((c as any).history)) {
              puMsgCount += (c as any).history.length;
            }
          }
        }

        totalMessagesCount += puMsgCount;
        platformMessagesCount += puMsgCount;
        if (pu.isSubscribed) platformSubscribed++;
        if (pu.promoUsed) platformPromoCount++;

        const chatsList: any[] = [];
        if (pu.chats) {
          for (const c of Object.values(pu.chats) as any[]) {
            if (!c) continue;
            chatsList.push({
              bot: "PlatformBot",
              name: c.name || "Диалог Platform",
              messagesCount: Array.isArray(c.history) ? c.history.length : 0,
              history: c.history || []
            });
          }
        }

        list.push({
          id: `platform_${id}`,
          rawId: id,
          origin: "platform",
          username: pu.username || null,
          firstName: pu.firstName || "Пользователь Platform",
          joinedAt: pu.joinedAt || new Date().toISOString(),
          isSubscribed: !!pu.isSubscribed,
          messagesToday: pu.messagesToday || 0,
          totalMessagesCount: puMsgCount,
          lastActive: pu.lastMessageDate || "Неактивен",
          activeModelOrMode: pu.activeModel || "gemini-3.5-flash",
          chatsCount: chatsList.length,
          chats: chatsList,
          promoUsed: pu.promoUsed || null,
          proRevoked: !!pu.proRevoked,
          adminNote: (pu as any).adminNote || null
        });
      }

      // Sort by joinedAt descending
      list.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());

      res.json({
        stats: {
          totalUsersCombined: Object.keys(users || {}).length + Object.keys(platformUsers || {}).length,
          wolffUsersCount: Object.keys(users || {}).length,
          platformUsersCount: Object.keys(platformUsers || {}).length,
          totalMessagesCount,
          wolffMessagesCount,
          platformMessagesCount,
          wolffSubscribed,
          platformSubscribed,
          totalSubscribed: wolffSubscribed + platformSubscribed,
          wolffPromoCount,
          platformPromoCount,
          totalPromoCount: wolffPromoCount + platformPromoCount
        },
        users: list
      });
    } catch (err: any) {
      console.error("Failed to generate admin users data:", err);
      res.status(500).json({ error: "Inner database lookup failed: " + err.message });
    }
  });

  app.post("/api/admin/user/toggle-subscription", (req, res) => {
    try {
      const { id, origin, revokeRules } = req.body;
      if (!id || !origin) {
        return res.status(400).json({ error: "Missing user ID or bot origin type" });
      }

      if (origin === "wolff") {
        if (users[id]) {
          if (revokeRules) {
            users[id].isSubscribed = false;
            users[id].proRevoked = true;
          } else {
            users[id].isSubscribed = !users[id].isSubscribed;
            if (users[id].isSubscribed) {
              users[id].proRevoked = false;
            }
          }
          saveDB();
          return res.json({ success: true, isSubscribed: users[id].isSubscribed, proRevoked: users[id].proRevoked });
        } else {
          return res.status(404).json({ error: "User on Wolff DB not found" });
        }
      } else if (origin === "platform") {
        if (platformUsers[id]) {
          if (revokeRules) {
            platformUsers[id].isSubscribed = false;
            platformUsers[id].proRevoked = true;
          } else {
            platformUsers[id].isSubscribed = !platformUsers[id].isSubscribed;
            if (platformUsers[id].isSubscribed) {
              platformUsers[id].proRevoked = false;
            }
          }
          savePlatformDBInBot();
          return res.json({ success: true, isSubscribed: platformUsers[id].isSubscribed, proRevoked: platformUsers[id].proRevoked });
        } else {
          return res.status(404).json({ error: "User on Platform DB not found" });
        }
      }

      res.status(400).json({ error: "Unknown origin db target type" });
    } catch (err: any) {
      console.error("Toggle subscription backend failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/user/save-note", (req, res) => {
    try {
      const { id, origin, note } = req.body;
      if (!id || !origin) {
        return res.status(400).json({ error: "Missing user ID or bot origin type" });
      }

      const noteStr = (note || "").slice(0, 1000); // safety cap

      if (origin === "wolff") {
        if (users[id]) {
          (users[id] as any).adminNote = noteStr;
          saveDB();
          return res.json({ success: true, adminNote: (users[id] as any).adminNote });
        } else {
          return res.status(404).json({ error: "User on Wolff DB not found" });
        }
      } else if (origin === "platform") {
        if (platformUsers[id]) {
          (platformUsers[id] as any).adminNote = noteStr;
          savePlatformDBInBot();
          return res.json({ success: true, adminNote: (platformUsers[id] as any).adminNote });
        } else {
          return res.status(404).json({ error: "User on Platform DB not found" });
        }
      }

      res.status(400).json({ error: "Unknown origin db target type" });
    } catch (err: any) {
      console.error("Save note backend failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/keep-awake-status", (req, res) => {
    res.json({
      lastKnownPublicUrl,
      lastPingTime,
      pingCount,
      isProd
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
