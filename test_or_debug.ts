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
     const text = await apiRes.text();
     console.log(text.slice(0, 300));
  } catch(e: any) {
    clearTimeout(timeoutId);
    console.log(m, "FAILED:", e.message);
  }
}

async function main() {
  await checkModel("meta-llama/llama-3.3-70b-instruct:free");
  await checkModel("nousresearch/hermes-3-llama-3.1-405b:free");
  await checkModel("qwen/qwen3-coder:free");
}
main();
