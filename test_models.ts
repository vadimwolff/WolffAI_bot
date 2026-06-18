import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function run() {
  try {
    let tools = undefined;
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: "Привет",
      config: {
        systemInstruction: "Ты WolffAi",
        tools: tools
      }
    });
    console.log("SUCCESS:", response.text);
  } catch (e: any) {
    console.error("ERROR:", e.message);
  }
}
run();
