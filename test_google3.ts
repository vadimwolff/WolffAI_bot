import { GoogleGenAI } from "@google/genai";

async function main() {
  const aiClient = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  try {
     const req = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
     const data = await req.json();
     for (const m of data.models) {
        console.log(m.name);
     }
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}
main();