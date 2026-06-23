const fs = require('fs');
let pb = fs.readFileSync('platformBot.ts', 'utf8');

pb = pb.replace(/🤖 <b>Gemini 3\.5 Flash, Gemini 3\.1 Flash Lite, Gemma 4 31B, Llama 3\.3 70B, Hermes 405B<\/b> и другими передовыми моделями!/g, "🤖 <b>Gemini 3.5 Flash, Gemini 3.1 Pro, Gemini 2.5 Flash, Gemma 4 31B, Gemma 4 26B</b> и другими передовыми моделями!");

pb = pb.replace(/• Остальные OpenRouter модели \(Llama 3\.3, Hermes 3 и др\.\): <b>100 запросов<\/b>\\n/g, "• Остальные модели: <b>100 запросов</b>\\n");

fs.writeFileSync('platformBot.ts', pb);
