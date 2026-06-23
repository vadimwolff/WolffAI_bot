import fetch from "node-fetch";

async function checkModel(m: string) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const apiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
       method: "POST",
       headers: { 
         "Authorization": `Bearer ${openrouterKey}`, 
         "Content-Type": "application/json",
         "HTTP-Referer": "https://google.com",
         "X-Title": "TestApp"
       },
       body: JSON.stringify({ model: m, messages: [{role: "user", content: "hi"}] }),
       signal: controller.signal
     });
     clearTimeout(timeoutId);
     console.log(m, "STATUS:", apiRes.status);
     const resJson = await apiRes.json();
     console.log(JSON.stringify(resJson).slice(0, 300));
  } catch(e: any) {
    clearTimeout(timeoutId);
    console.log(m, "FAILED:", e.message);
  }
}

async function main() {
  await checkModel("meta-llama/llama-3-8b-instruct:free");
  await checkModel("mistralai/mistral-7b-instruct:free");
  await checkModel("microsoft/phi-3-medium-128k-instruct:free");
  await checkModel("google/gemma-2-9b-it:free");
}
main();
