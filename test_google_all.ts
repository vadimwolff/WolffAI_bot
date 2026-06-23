import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  const models = [
    "gemini-2.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-pro-preview",
    "deep-research-pro-preview-12-2025",
    "antigravity-preview-05-2026",
    "nano-banana-pro-preview"
  ];
  for (const m of models) {
    try {
      const geminiResponse = await aiClient.models.generateContent({
        model: m,
        contents: "hi",
      });
      console.log(m, "SUCCESS", geminiResponse.text?.slice(0, 20));
    } catch (e: any) {
      console.error(m, "ERROR", e.message);
    }
  }
}
main();
