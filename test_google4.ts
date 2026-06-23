import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  try {
    const geminiResponse = await aiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: "hi",
    });
    console.log("Success 3.5 flash:", geminiResponse.text);
  } catch (e: any) {
    console.error("Error flash:", e.message);
  }
}
main();