const fs = require('fs');

let pb = fs.readFileSync('platformBot.ts', 'utf8');
let s = fs.readFileSync('server.ts', 'utf8');

// 1. Update MODELS_INFO in platformBot.ts
const modelsInfo = `const MODELS_INFO = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", desc: "Ультрабыстрый мультимодальный флагман (Новейшая версия).", multimodal: true },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", desc: "Сверхмощная экспериментальная модель Google.", multimodal: true },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", desc: "Надежная быстрая мультимодальная модель.", multimodal: true },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", desc: "Супер-быстрая и легкая версия Gemini.", multimodal: true },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", desc: "Быстрая модель 3-го поколения.", multimodal: true },
  { id: "gemma-4-31b-it", name: "Gemma 4 31B", desc: "Открытая текстовая модель от Google.", multimodal: false },
  { id: "gemma-4-26b-a4b-it", name: "Gemma 4 26B", desc: "Более быстрая открытая текстовая модель Google.", multimodal: false }
];`;

pb = pb.replace(/const MODELS_INFO = \[[^]*?\];/, modelsInfo);

// Update limits so they work for the new models
const limitsReplacement = `
  let limit = 100;
  if (modelId === "gemini-3.5-flash") {
    limit = 50;
  } else if (modelId === "gemini-3.1-pro-preview") {
    limit = 500;
  } else if (modelId.startsWith("gemini-")) {
    limit = 50;
  } else if (modelId.startsWith("gemma-")) {
    limit = 100;
  }
`;
pb = pb.replace(/let limit = 100;\s*\/\/[^]*?if \(current >= limit\)/, limitsReplacement + "\n  if (current >= limit)");

// Route all 'gemma-' to Google API
pb = pb.replace(/} else if \(modelId\.startsWith\("gemini-"\)\) {/g, '} else if (modelId.startsWith("gemini-") || modelId.startsWith("gemma-")) {');

// Fallbacks update in platformBot
const fallbacksStr = `const fallbacks = ["gemini-3.5-flash", "gemma-4-31b-it"].filter`;
pb = pb.replace(/const fallbacks = \["gemini-3\.5-flash", "gemini-3\.1-pro-preview", "meta-llama[^]*?\]\.filter/g, fallbacksStr);

// Pro status indicator in platformBot
pb = pb.replace(/👋 Привет, \$\{ctx\.from\.first_name\}!/g, "👋 Привет, ${ctx.from.first_name}!" + "${u.isSubscribed ? ' 💎 <b>[PRO]</b>' : ''}");
pb = pb.replace(/🤖 <b>Выбор ИИ Модели:<\/b>/g, "🤖 <b>Выбор ИИ Модели:</b>${u.isSubscribed ? ' 💎 <b>[PRO]</b>' : ''}");
pb = pb.replace(/👤 <b>Ваш профиль:<\/b>\\n/g, "👤 <b>Ваш профиль:</b>\\n` +\n      `Статус: ` + (u.isSubscribed ? '💎 <b>PRO (Безлимит)</b>' : '🆓 <b>Бесплатный</b>') + `\\n");

// And similarly for server.ts bots (Normal Bot, Angry Bot, Image Bot)
// Add [PRO] to start message
s = s.replace(/Привет, \$\{ctx\.from\.first_name\}! Я Wolff AI/g, "Привет, ${ctx.from.first_name}!${user.isSubscribed ? ' 💎 [PRO]' : ''} Я Wolff AI");

// Add [PRO] to angry bot
s = s.replace(/Привет, кожаный мешок \$\{ctx\.from\.first_name\}\./g, "Привет, кожаный мешок ${ctx.from.first_name}.${user.isSubscribed ? ' Я вижу твой 💎 PRO статус, но это не спасет тебя от моего презрения.' : ''}");

// Replace "meta-llama" in generateWithFallback
s = s.replace(/if \(!candidates\.includes\("meta-llama[^]*?\);\n/g, 'if (!candidates.includes("gemma-4-31b-it")) candidates.push("gemma-4-31b-it");\n');

// Also update generating fallback in server.ts
s = s.replace(/const fallbacks = \["gemini-3\.5-flash", "gemini-3\.1-pro-preview", "meta-llama[^]*?\]\.filter/g, fallbacksStr);

fs.writeFileSync('platformBot.ts', pb);
fs.writeFileSync('server.ts', s);
