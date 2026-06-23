import fetch from "node-fetch";

async function main() {
  const models = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "nousresearch/hermes-3-llama-3.1-405b:free",
    "qwen/qwen3-coder:free",
    "google/gemma-4-31b-it:free",
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
  ];
  for (const m of models) {
    const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, messages: [{role: "user", content: "hi"}] })
    });
    console.log(m, apiRes.status);
  }
}
main();
