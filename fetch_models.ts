import fs from "fs";
async function main() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const data = await res.json();
  fs.writeFileSync("models.json", JSON.stringify(data, null, 2));
  console.log("Written", data.data.length, "models");
}
main().catch(console.error);