import fs from "fs";

function main() {
  const data = JSON.parse(fs.readFileSync("models.json", "utf8")).data;
  const freeModels = data.filter((m: any) => parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0);
  
  for (const m of freeModels) {
    if (m.id.includes("deepseek") || m.id.includes("llama") || m.id.includes("qwen") || m.id.includes("google") || m.id.includes("nemotron") || m.id.includes("dolphin") || m.id.includes("hermes")) {
      console.log(m.id, "-", m.name);
    }
  }
}
main();