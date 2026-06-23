import fetch from "node-fetch";
import fs from "fs";

async function main() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const data = JSON.parse(fs.readFileSync("models.json", "utf8")).data;
  const freeModels = data.filter((m: any) => parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0);
  
  for (const m of freeModels) {
    try {
      const controller = new AbortController();
      const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openrouterKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.id, messages: [{role: "user", content: "hi"}] }),
        signal: controller.signal
      });
      console.log(m.id, apiRes.status);
    } catch(e) {}
  }
}
main();
