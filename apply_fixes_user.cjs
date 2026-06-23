const fs = require('fs');

let pb = fs.readFileSync('platformBot.ts', 'utf8');
let s = fs.readFileSync('server.ts', 'utf8');

// 1. Revert MODELS_INFO to include all smart models
const modelsInfo = `const MODELS_INFO = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", desc: "Ультрабыстрый мультимодальный флагман Google.", multimodal: true },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", desc: "Сверхмощная экспериментальная модель Google.", multimodal: true },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", desc: "Надежная быстрая мультимодальная модель.", multimodal: true },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", desc: "Супер-быстрая и легкая версия Gemini. (Резервная)", multimodal: true },
  { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B", desc: "Мощная открытая модель от Meta.", multimodal: false },
  { id: "nousresearch/hermes-3-llama-3.1-405b:free", name: "Hermes 3 405B", desc: "Сверхмощная открытая модель от NousResearch.", multimodal: false },
  { id: "qwen/qwen3-coder:free", name: "Qwen 3 Coder", desc: "Продвинутая модель для написания кода.", multimodal: false },
  { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", desc: "Открытая текстовая модель от Google (OpenRouter).", multimodal: false },
  { id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", name: "Dolphin Mistral 24B", desc: "Модель без цензуры (Venice Edition).", multimodal: false },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "Nemotron 3 30B", desc: "Reasoning модель от Nvidia.", multimodal: false }
];`;

pb = pb.replace(/const MODELS_INFO = \[[^]*?\];/, modelsInfo);

// Update limits logic to recognize these
const limitsReplacement = `
  let limit = 100;
  if (modelId === "gemini-3.5-flash") {
    limit = 50;
  } else if (modelId === "gemini-3.1-pro-preview") {
    limit = 500;
  } else if (modelId.startsWith("gemini-")) {
    limit = 50;
  } else {
    limit = 100;
  }
`;
pb = pb.replace(/let limit = 100;\s*\/\/[^]*?if \(current >= limit\)/, limitsReplacement + "\n  if (current >= limit)");

// Update routing so we only route Google APIs natively if they don't have a slash (which OpenRouter ones do)
pb = pb.replace(/} else if \(modelId\.startsWith\("gemini-"\) \|\| modelId\.startsWith\("gemma-"\)\) {/g, '} else if (modelId.startsWith("gemini-") && !modelId.includes("/")) {');

// 2. Platform bot fallback to gemini-3.1-flash-lite
pb = pb.replace(/const fallbacks = \[.*?\]\.filter/g, `const fallbacks = ["gemini-3.1-flash-lite"].filter`);

// 3. Platform Invoice
pb = pb.replace(/title: "🌟 Подписка PRO \(1 месяц\)",\s*description: "Безлимитный доступ ко всем ИИ-моделям на платформе WolffAIPlatform на 30 дней\.",/g, 
  `title: "🌟 Подписка PRO (2 месяца)",\n        description: "Безлимитный доступ на 2 месяца ко всей экосистеме ботов Wolff AI (Мультимодельная платформа WolffAI Platform, Базовый WolffAI, Злой AngryAI, Художник ImageBot). Оплата Telegram Stars.",`);
pb = pb.replace(/title: "🌟 Подписка PRO \(1 месяц\)",/g, `title: "🌟 Подписка PRO (2 месяца)",`);
pb = pb.replace(/amount: 50/g, `amount: 150`); // If it was 50

// We also need to be sure about the prices: Цена за 2 месяца - 150 звезд
pb = pb.replace(/amount: \d+,/g, `amount: 150,`); 

pb = pb.replace(/PRO подписку на 1 месяц за [\d]+ звезд/g, "PRO подписку на 2 месяца за 150 звезд");

// 4. Server bot fallback update
// Wait, we need to locate where candidates are populated in server.ts
s = s.replace(/const candidates \= \[model\];\n\s+if \(\!candidates\.includes\("gemini-3\.5-flash"\)\) candidates\.push\("gemini-3\.5-flash"\);\n\s+if \(\!candidates\.includes\("gemini-3\.1-pro-preview"\)\) candidates\.push\("gemini-3\.1-pro-preview"\);\n\s+if \(\!candidates\.includes\("gemma-4-31b-it"\)\) candidates\.push\("gemma-4-31b-it"\);/g, 
  `const candidates = [model];
  if (!candidates.includes("gemini-3.1-flash-lite")) candidates.push("gemini-3.1-flash-lite");`);

// Server fallback array update
s = s.replace(/const fallbacks = \[.*?\]\.filter/g, `const fallbacks = ["gemini-3.1-flash-lite"].filter`);

// 5. Server Invoice
s = s.replace(/title: "Подписка PRO \(1 месяц\)",\s*description: "Безлимитный доступ \(150 рублей в месяц\)\. Оплата Telegram Stars \(пополняются картой или монетами TON\)\.",/g, 
  `title: "Подписка PRO (2 месяца)",\n        description: "Безлимитный доступ на 2 месяца ко всей экосистеме ботов Wolff AI (Мультимодельная платформа WolffAI Platform, Базовый WolffAI, Злой AngryAI, Художник ImageBot). Оплата Telegram Stars.",`);
s = s.replace(/amount: \d+/g, `amount: 150`); 

// Other text things platformBot
pb = pb.replace(/🤖 <b>Gemini 3\.5 Flash, Gemini 3\.1 Pro, Gemini 2\.5 Flash, Gemma 4 31B, Gemma 4 26B<\/b> и другими передовыми моделями!/g, 
  "🤖 <b>Gemini 3.5 Flash, Gemini 3.1 Pro, Llama 3.3 70B, Hermes 405B, Qwen, Nemotron</b> и другими передовыми моделями!");

fs.writeFileSync('platformBot.ts', pb);
fs.writeFileSync('server.ts', s);
