import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testModel(modelName: string, tools?: any) {
  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: "Hello",
      config: tools ? { tools } : undefined
    });
    console.log(`${modelName} success:`, response.text?.substring(0, 20));
  } catch (e: any) {
    console.error(`${modelName} error:`, e.message);
  }
}

async function run() {
  await testModel("gemma-4-26b-a4b-it", [{ googleSearch: {} }]);
}
run();
