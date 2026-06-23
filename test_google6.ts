import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  const ms = ["gemini-3-flash-preview", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"];
  for (const m of ms) {
    try {
      const g = await aiClient.models.generateContent({ model: m, contents: "hi" });
      console.log(m, "SUCCESS", g.text?.slice(0, 50));
    } catch(e:any) { console.log(m, "ERROR", e.message.slice(0, 50)); }
  }
}
main();
