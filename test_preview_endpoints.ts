import fetch from "node-fetch";

async function run() {
  const previewUrl = process.env.WEBHOOK_DOMAIN || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app";
  const devUrl = process.env.APP_URL || "https://ais-dev-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app";
  
  console.log(`Checking DEV URL: ${devUrl}/api/stats`);
  try {
    const res = await fetch(`${devUrl}/api/stats`);
    console.log(`DEV Status:`, res.status);
    const text = await res.text();
    console.log(`DEV Body:`, text);
  } catch (err: any) {
    console.error(`DEV Error:`, err.message);
  }
  
  console.log(`\nChecking PREVIEW URL: ${previewUrl}/api/stats`);
  try {
    const res = await fetch(`${previewUrl}/api/stats`);
    console.log(`PREVIEW Status:`, res.status);
    const text = await res.text();
    console.log(`PREVIEW Body:`, text);
  } catch (err: any) {
    console.error(`PREVIEW Error:`, err.message);
  }
}

run();
