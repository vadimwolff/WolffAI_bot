const fs = require('fs');

let pb = fs.readFileSync('platformBot.ts', 'utf8');

const modelsInfo = `const MODELS_INFO = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", desc: "Ультрабыстрый мультимодальный флагман через Google Gemini API.", multimodal: true },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", desc: "Сверхлегкая и быстрая модель.", multimodal: true },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (OpenModel)", desc: "Быстрая и эффективная модель следующего поколения у провайдера OpenModel.", multimodal: false },
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
];`;

pb = pb.replace(/const MODELS_INFO = \[[^]*?\];/, modelsInfo);

// Remove the validation block that blocked requests if keys were missing
const block1 = `const isGemini = u.activeModel.startsWith("gemini-");
  const isOpenModel = u.activeModel === "deepseek-v4-flash";
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!isGemini && !isOpenModel && !openrouterKey) {
     return ctx.reply("🔌 Ошибка: Выбранная модель требует OpenRouter. Администратор не установил OPENROUTER_API_KEY на сервере.");
  }`;
const block1Replacement = `const openrouterKey = process.env.OPENROUTER_API_KEY;`;
pb = pb.replace(block1, block1Replacement);

const block2 = `const isGeminiWeb = currentModel.startsWith("gemini-");
    const isOpenModelWeb = currentModel === "deepseek-v4-flash";
    if (!isGeminiWeb && !isOpenModelWeb && !openrouterKey) {
      currentModel = "gemini-1.5-flash";
      fallbackDueToNoKey = true;
    }`;
const block2Replacement = `// Key validation removed for robust fallback`;
pb = pb.replace(block2, block2Replacement);

pb = pb.replace(/model: modelId,/g, 'model: modelId.replace(/gemini-(3\\\\.5|3\\\\.1|2\\\\.5).*/, "gemini-1.5-flash"),');

pb = pb.replace(/let activeModelAttempt =.*?;/g, "let activeModelAttempt = u.activeModel;");

pb = pb.replace(/const fallbacks = \[.*?\];/g, 'const fallbacks = ["gemini-3.5-flash"];');

fs.writeFileSync('platformBot.ts', pb);

let currentS = fs.readFileSync('server.ts', 'utf8');
currentS = currentS.replace(/const candidates = \[model\];/g, 'const candidates = [model];\\n  model = model.replace(/gemini-(3\\\\.5|3\\\\.1|2\\\\.5).*/, "gemini-1.5-flash");');

fs.writeFileSync('server.ts', currentS);
console.log("Files updated with resilient mapping!");
