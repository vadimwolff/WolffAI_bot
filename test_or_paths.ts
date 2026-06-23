import fetch from "node-fetch";

const token = "om-2EYR7FAxLYTj197dyvQU6hoGcixLfEP7zsegu3TctHt";

async function check(url: string) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });
    console.log(`GET ${url}: status = ${res.status}`);
    if (res.status === 200) {
      const data = await res.text();
      console.log(data.slice(0, 300));
    }
  } catch (e: any) {
    console.log(`GET ${url} failed: ${e.message}`);
  }
}

async function checkPost(url: string) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [{ role: "user", content: "hi" }]
      })
    });
    console.log(`POST ${url}: status = ${res.status}`);
    if (res.status === 200) {
      const data = await res.text();
      console.log(data.slice(0, 300));
    } else {
      const data = await res.text();
      console.log(data.slice(0, 200));
    }
  } catch (e: any) {
    console.log(`POST ${url} failed: ${e.message}`);
  }
}

async function main() {
  await check("https://api.openmodels.run/v1/models");
  await check("https://api.openmodels.run/models");
  await check("https://api.openmodels.run/api/v1/models");
  await check("https://api.openmodels.run/openai/v1/models");
  
  await checkPost("https://api.openmodels.run/v1/chat/completions");
  await checkPost("https://api.openmodels.run/chat/completions");
  await checkPost("https://api.openmodels.run/api/v1/chat/completions");
  await checkPost("https://api.openmodels.run/openai/v1/chat/completions");
}

main();
