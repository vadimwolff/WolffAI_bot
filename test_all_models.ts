import { GoogleGenAI } from "@google/genai";
import fetch from "node-fetch";

const geminiApiKey = process.env.GEMINI_API_KEY;
const openrouterKey = process.env.OPENROUTER_API_KEY;
const openmodelKey = process.env.OPENMODEL_API_KEY || "om-2EYR7FAxLYTj197dyvQU6hoGcixLfEP7zsegu3TctHt";

console.log("GEMINI_API_KEY exists:", !!geminiApiKey);
console.log("OPENROUTER_API_KEY exists:", !!openrouterKey);

const googleModels = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
];

const openRouterModels = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "qwen/qwen3-coder:free",
  "google/gemma-4-31b-it:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"
];

async function testGoogle() {
  if (!geminiApiKey) return;
  const aiClient = new GoogleGenAI({ apiKey: geminiApiKey });
  for (const m of googleModels) {
    try {
      const res = await aiClient.models.generateContent({
        model: m,
        contents: "hi",
      });
      console.log(`[Google] ${m}: SUCCESS`, res.text ? res.text.slice(0, 30) : "NO TEXT");
    } catch (e: any) {
      console.log(`[Google] ${m}: FAILED`, e.message);
    }
  }
}

async function testOpenModels() {
  try {
    const res = await fetch("https://api.openmodels.run/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openmodelKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }]
      })
    });
    console.log(`[OpenModels] deepseek-v4-flash: STATUS ${res.status}`, res.status === 200 ? "SUCCESS" : await res.text());
  } catch (e: any) {
    console.log(`[OpenModels] deepseek-v4-flash: FAILED`, e.message);
  }
}

async function testOpenRouter() {
  if (!openrouterKey) {
    console.log("No OpenRouter Key, skipping OpenRouter tests");
    return;
  }
  for (const m of openRouterModels) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: "user", content: "hi" }]
        })
      });
      console.log(`[OpenRouter] ${m}: STATUS ${res.status}`, res.status === 200 ? "SUCCESS" : await res.text());
    } catch (e: any) {
      console.log(`[OpenRouter] ${m}: FAILED`, e.message);
    }
  }
}

async function main() {
  await testGoogle();
  await testOpenModels();
  await testOpenRouter();
}

main();
