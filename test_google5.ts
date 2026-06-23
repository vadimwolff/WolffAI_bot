import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  try {
    const geminiResponse = await aiClient.models.generateContent({
      model: "gemma-4-31b-it",
      contents: "hi",
    });
    console.log("Success gemma-4-31b-it:", geminiResponse.text);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}
main();
