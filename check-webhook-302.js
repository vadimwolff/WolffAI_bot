import https from 'https';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const url = "https://ais-dev-crxcvc7jvjmvqgisciea2c-529864647051.europe-west1.run.app/telegraf/" + botToken;

const req = https.request(url, { method: 'POST' }, (res) => {
  console.log('STATUS:', res.statusCode);
  console.log('HEADERS:', res.headers);
});
req.end();
