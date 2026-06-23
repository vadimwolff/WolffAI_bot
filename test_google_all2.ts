import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  const models = [
    "gemini-3.1-pro-preview",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it"
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
