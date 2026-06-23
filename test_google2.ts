import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  try {
    const geminiResponse = await aiClient.models.generateContent({
      model: "gemini-1.5-flash",
      contents: "hi",
    });
    console.log("Success 1.5 flash");
  } catch (e: any) {
    console.error("Error flash:", e.message);
  }
}
main();