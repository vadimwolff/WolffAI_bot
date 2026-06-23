import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  try {
    const geminiResponse = await aiClient.models.generateContent({
      model: "gemini-2.5-pro",
      contents: "hi",
    });
    console.log("Success");
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}
main();