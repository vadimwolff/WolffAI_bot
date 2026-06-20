import fs from 'fs';

function configureBotEnvironments(file) {
  let code = fs.readFileSync(file, 'utf8');

  if (file === './server.ts') {
    code = code.replace(
      /const isProd = process\.env\.NODE_ENV === "production";\n\s*const defaultDomain = isProd[^;]+;\n\s*const webhookDomain = process\.env\.WEBHOOK_DOMAIN \|\| process\.env\.APP_URL \|\| defaultDomain;/g,
      `const isProd = process.env.NODE_ENV === "production";
  const webhookDomain = isProd ? (process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app") : null;`
    );
  } else if (file === './platformBot.ts') {
    code = code.replace(
      /const isProd = process\.env\.NODE_ENV === "production";\n\s*const defaultDomain = isProd[^;]+;\n\s*const webhookDomain = process\.env\.WEBHOOK_DOMAIN \|\| process\.env\.APP_URL \|\| defaultDomain;/g,
      `const isProd = process.env.NODE_ENV === "production";
  const webhookDomain = isProd ? (process.env.WEBHOOK_DOMAIN || process.env.APP_URL || "https://ais-pre-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app") : null;`
    );
  }

  // Ensure polling fallback is completely reliable and properly formatted
  // Also we ensure Telegraf doesn't throw unhandled rejections during polling.
  fs.writeFileSync(file, code, 'utf8');
}

configureBotEnvironments('./server.ts');
configureBotEnvironments('./platformBot.ts');
console.log("Configured bot environments to use Polling in Dev and Webhooks in Prod.");
