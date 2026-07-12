// Lance ce script pour voir tous les groupes/canaux de ton ami
// node listchats.js

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const fs = require('fs');

const cfg     = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json', 'utf8')) : {};
const API_ID  = parseInt(process.env.API_ID  || cfg.api_id  || '2040');
const API_HASH =         process.env.API_HASH || cfg.api_hash || 'b18441a1ff607e10a989891a5462e627';
const SESSION =          process.env.SESSION  || cfg.session  || '';

(async () => {
  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, { connectionRetries: 5 });
  await client.connect();
  console.log('✅ Connecté\n');

  const dialogs = await client.getDialogs({ limit: 50 });
  for (const d of dialogs) {
    if (d.isGroup || d.isChannel) {
      console.log('📌', d.title, '\n   ID :', -Math.abs(d.id.valueOf()), '\n');
    }
  }
  await client.disconnect();
})();

