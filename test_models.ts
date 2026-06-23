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
    "meta-llama/llama-3.3-70b-instruct:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "qwen/qwen3-coder:free",
    "google/gemma-4-31b-it:free",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"
  ];
  for (const m of models) {
    await testModel(m);
  }
}
main();
