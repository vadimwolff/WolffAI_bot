import { GoogleGenAI } from "@google/genai";

async function main() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  console.log("openrouter:", openrouterKey ? "configured" : "missing");
  
  const aiClient = process.env.GEMINI_API_KEY ? new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY}) : null;
  console.log("gemini:", aiClient ? "configured" : "missing");
  
  const m = "deepseek/deepseek-r1:free";
  
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
  
  console.log(apiRes.status, await apiRes.text());
}
main().catch(console.error);