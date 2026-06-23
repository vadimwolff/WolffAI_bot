import fs from "fs";

function main() {
  const data = JSON.parse(fs.readFileSync("models.json", "utf8")).data;
  const ds = data.find((m: any) => m.id === "deepseek/deepseek-v4-flash");
  console.log(ds ? ds.pricing : "Not found");
}
main();