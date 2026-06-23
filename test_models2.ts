import fetch from "node-fetch";

async function testModel(m: string) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const controller = new AbortController();
  const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: m,
      messages: [{role: "user", content: "hi"}]
    }),
    signal: controller.signal
  });
  console.log(m, apiRes.status, await apiRes.text());
}

async function main() {
  const models = [
    "meta-llama/llama-3.2-3b-instruct:free",
    "qwen/qwen-wtc-instruct:free",
    "google/gemma-4-31b-it:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "cognitivecomputations/dolphin3.0-r1-mistral-24b:free",
    "deepseek/deepseek-chat:free",
    "deepseek/deepseek-r1:free"
  ];
  for (const m of models) {
    try {
        await testModel(m);
    } catch(e) { console.error(m, e) }
  }
}
main();
