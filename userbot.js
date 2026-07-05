// Userbot : écoute le groupe source SANS y être bot
// L'ami n'a pas besoin d'ajouter le bot dans la source

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');
const axios              = require('axios');
const FormData           = require('form-data');
const fs                 = require('fs');

const cfg = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json', 'utf8')) : {};

// Credentials Telegram Desktop (publics, pas besoin de my.telegram.org)
const API_ID    = parseInt(process.env.API_ID    || cfg.api_id    || '2040');
const API_HASH  =          process.env.API_HASH  || cfg.api_hash  || 'b18441a1ff607e10a989891a5462e627';
const SESSION   =          process.env.SESSION   || cfg.session   || '';
const SOURCE_ID = parseInt(process.env.SOURCE_ID || cfg.source_id || 0);
const DEST_ID   = parseInt(process.env.DEST_ID   || cfg.dest_id   || 0);
const BOT_TOKEN =          process.env.TOKEN     || cfg.token     || '';

if (!API_ID || !API_HASH || !SESSION) {
  console.log('❌ API_ID, API_HASH ou SESSION manquant. Lance setup.js d\'abord.');
  process.exit(1);
}
if (!SOURCE_ID || !DEST_ID) { console.log('❌ SOURCE_ID ou DEST_ID manquant.'); process.exit(1); }
if (!BOT_TOKEN)              { console.log('❌ TOKEN (bot SHAFX) manquant.');    process.exit(1); }

const BOT_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function botSend(method, params) {
  return axios.post(`${BOT_URL}/${method}`, params).then(r => r.data).catch(e => {
    console.log('❌ botSend', method, e.response?.data?.description || e.message);
  });
}

async function copy(client, msg) {
  const h = new Date().toLocaleTimeString('fr-FR');
  try {
    if (msg.message && !msg.media) {
      await botSend('sendMessage', { chat_id: DEST_ID, text: msg.message });
      console.log('[' + h + '] ✉️ texte →', DEST_ID);

    } else if (msg.media) {
      const buf = await client.downloadMedia(msg, {});
      if (!buf) {
        await botSend('sendMessage', { chat_id: DEST_ID, text: msg.message || '[media non téléchargeable]' });
        console.log('[' + h + '] ⚠️ media vide, texte envoyé');
        return;
      }

      const fd = new FormData();
      fd.append('chat_id', String(DEST_ID));
      if (msg.message) fd.append('caption', msg.message);

      const className = msg.media.className || '';
      let type = 'inconnu';

      if (className === 'MessageMediaPhoto') {
        fd.append('photo', buf, { filename: 'photo.jpg', contentType: 'image/jpeg', knownLength: buf.length });
        await axios.post(`${BOT_URL}/sendPhoto`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
        type = '📷 photo';

      } else if (className === 'MessageMediaDocument') {
        const mime = msg.media.document?.mimeType || 'application/octet-stream';
        const ext  = mime.split('/')[1] || 'bin';
        const isAnim = msg.media.document?.attributes?.find(a => a.className === 'DocumentAttributeAnimated');

        if (isAnim) {
          fd.append('animation', buf, { filename: 'anim.mp4', contentType: 'video/mp4', knownLength: buf.length });
          await axios.post(`${BOT_URL}/sendAnimation`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
          type = '🎞️ anim';
        } else if (mime.startsWith('video/')) {
          fd.append('video', buf, { filename: `video.${ext}`, contentType: mime, knownLength: buf.length });
          await axios.post(`${BOT_URL}/sendVideo`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
          type = '🎥 vidéo';
        } else if (mime.startsWith('audio/')) {
          fd.append('audio', buf, { filename: `audio.${ext}`, contentType: mime, knownLength: buf.length });
          await axios.post(`${BOT_URL}/sendAudio`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
          type = '🎵 audio';
        } else {
          fd.append('document', buf, { filename: `file.${ext}`, contentType: mime, knownLength: buf.length });
          await axios.post(`${BOT_URL}/sendDocument`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
          type = '📄 document';
        }
      } else {
        fd.append('document', buf, { filename: 'file', contentType: 'application/octet-stream', knownLength: buf.length });
        await axios.post(`${BOT_URL}/sendDocument`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
        type = '📎 fichier';
      }

      console.log('[' + h + '] ' + type + ' →', DEST_ID, buf.length + ' octets');
    }
  } catch (e) {
    const detail = e.response?.data?.description || e.message;
    console.log('[' + h + '] ❌ ERREUR :', detail);
  }
}

(async () => {
  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 10,
    autoReconnect: true,
  });

  try {
    await client.connect();
    const me = await client.getMe();
    console.log('✅ Userbot connecté :', me.username || me.phone);
    console.log('👂 Source :', SOURCE_ID, '→ Destination :', DEST_ID);

    client.addEventHandler(
      async event => { await copy(client, event.message); },
      new NewMessage({ chats: [SOURCE_ID] })
    );

    process.once('SIGINT',  () => client.disconnect());
    process.once('SIGTERM', () => client.disconnect());

  } catch (err) {
    const msg = err.errorMessage || err.message || '';
    if (msg.includes('AUTH_KEY_UNREGISTERED') || (err.code === 401)) {
      console.log('🔑 SESSION expirée — envoi d\'une alerte dans SHAFX...');
      try {
        await axios.post(`${BOT_URL}/sendMessage`, {
          chat_id: DEST_ID,
          text: '⚠️ *Session userbot expirée*\n\nLe bot de transfert est arrêté\\.\n\n*À faire :*\n1\\. Lance `node setup\\.js` sur ton ordi\n2\\. Rentre ton numéro \\+ le code Telegram\n3\\. Copie la SESSION et envoie\\-la moi\n4\\. Je mettrai à jour Railway et relancerai',
          parse_mode: 'MarkdownV2'
        });
      } catch (e2) {
        console.log('(impossible d\'envoyer l\'alerte bot)');
      }
    }
    throw err;
  }
})();
