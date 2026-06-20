import request from 'supertest';
import express from 'express';
import { Telegraf } from 'telegraf';

const app = express();
const bot = new Telegraf('123:abc');
app.post('/test', bot.webhookCallback('/test'));

request(app)
  .post('/test')
  .send({ update_id: 1, message: { text: "hello" } })
  .set('Content-Type', 'application/json')
  .expect(200)
  .end((err, res) => {
    if (err) { console.error("FAILED:", err.message); process.exit(1); }
    else { console.log("SUCCESS"); process.exit(0); }
  });
