import fetch from "node-fetch";

async function main() {
  const openmodelKey = process.env.OPENMODEL_API_KEY || "om-2EYR7FAxLYTj197dyvQU6hoGcixLfEP7zsegu3TctHt";
  try {
    const res = await fetch("https://api.openmodels.run/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openmodelKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{role: "user", content: "hi"}]
      })
    });
    console.log(res.status, await res.text());
  } catch(e) {
    console.error(e);
  }
}
main();