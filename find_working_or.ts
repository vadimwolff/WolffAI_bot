import fetch from "node-fetch";
import fs from "fs";

async function main() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const data = JSON.parse(fs.readFileSync("models.json", "utf8")).data;
  const freeModels = data.filter((m: any) => parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0);
  
  let validOpenRouterModels: string[] = [];
  
  for (const m of freeModels) {
    if (validOpenRouterModels.length >= 5) break;
    // Skip Venice ones, we know they are rate limited
    if (m.id.includes("venice") || m.id.includes("mistral") || m.id.includes("llama-3.3") || m.id.includes("hermes-3")) continue; 
    try {
      const controller = new AbortController();
      const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.id, messages: [{role: "user", content: "hi"}] }),
        signal: controller.signal
      });
      if (apiRes.status === 200) {
          console.log("WORKING:", m.id, m.name);
          validOpenRouterModels.push(m.id);
      } else {
          console.log("FAILED:", m.id, apiRes.status);
      }
    } catch(e) {}
  }
}
main();
