import fetch from "node-fetch";

async function main() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const models = ["qwen/qwen-2.5-72b-instruct:free", "google/gemma-4-26b-a4b-it:free", "qwen/qwen3-next-80b-a3b-instruct:free"];
  for (const m of models) {
     const controller = new AbortController();
     const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, messages: [{role: "user", content: "hi"}] }),
        signal: controller.signal
      });
     console.log(m, apiRes.status);
  }
}
main();
