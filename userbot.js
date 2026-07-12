const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');
const axios              = require('axios');
const FormData           = require('form-data');
const fs                 = require('fs');

const cfg = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json', 'utf8')) : {};

const API_ID    = parseInt(process.env.API_ID    || cfg.api_id    || '2040');
const API_HASH  =          process.env.API_HASH  || cfg.api_hash  || 'b18441a1ff607e10a989891a5462e627';
const SOURCE_ID = parseInt(process.env.SOURCE_ID || cfg.source_id || 0);
const DEST_ID   = parseInt(process.env.DEST_ID   || cfg.dest_id   || 0);
const BOT_TOKEN =          process.env.TOKEN     || cfg.token     || '';

// Session persistante : volume Railway → fichier local → variable d'env
const SESSION_PATH  = '/data/session.txt';
const SESSION_LOCAL = './session_string.txt';
let sessionStr = '';
if (fs.existsSync(SESSION_PATH)) {
  sessionStr = fs.readFileSync(SESSION_PATH, 'utf8').trim();
  console.log('📂 Session chargée depuis le volume Railway');
} else if (fs.existsSync(SESSION_LOCAL)) {
  sessionStr = fs.readFileSync(SESSION_LOCAL, 'utf8').trim();
  console.log('📂 Session chargée depuis session_string.txt');
} else {
  sessionStr = process.env.SESSION || cfg.session || '';
  console.log('🔑 Session chargée depuis la variable d\'env');
}

if (!API_ID || !API_HASH || !sessionStr) {
  console.log('❌ API_ID, API_HASH ou SESSION manquant.');
  process.exit(1);
}
if (!SOURCE_ID || !DEST_ID) { console.log('❌ SOURCE_ID ou DEST_ID manquant.'); process.exit(1); }
if (!BOT_TOKEN)              { console.log('❌ TOKEN manquant.');                process.exit(1); }

const BOT_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

function saveSession(client) {
  try {
    const dir = '/data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_PATH, client.session.save());
  } catch (e) {
    // pas de volume monté — pas grave, on utilise la var d'env
  }
}

async function botSend(method, params) {
  return axios.post(`${BOT_URL}/${method}`, params).then(r => r.data).catch(e => {
    console.log('❌ botSend', method, e.response?.data?.description || e.message);
  });
}

const ENTITY_TYPE = {
  MessageEntityBold: 'bold', MessageEntityItalic: 'italic',
  MessageEntityUnderline: 'underline', MessageEntityStrike: 'strikethrough',
  MessageEntityCode: 'code', MessageEntityPre: 'pre',
  MessageEntityUrl: 'url', MessageEntityEmail: 'email',
  MessageEntityTextUrl: 'text_link', MessageEntityMention: 'mention',
  MessageEntityHashtag: 'hashtag', MessageEntityBotCommand: 'bot_command',
  MessageEntityCustomEmoji: 'custom_emoji', MessageEntitySpoiler: 'spoiler',
  MessageEntityBlockquote: 'blockquote',
};

function toApiEntities(entities) {
  if (!entities || !entities.length) return null;
  const out = [];
  for (const e of entities) {
    const type = ENTITY_TYPE[e.className];
    if (!type) continue;
    const entry = { type, offset: e.offset, length: e.length };
    if (type === 'text_link')    entry.url = e.url;
    if (type === 'pre')          entry.language = e.language || '';
    if (type === 'custom_emoji') entry.custom_emoji_id = String(e.documentId);
    out.push(entry);
  }
  return out.length ? out : null;
}

async function copy(client, msg) {
  const h = new Date().toLocaleTimeString('fr-FR');
  try {
    if (msg.message && !msg.media) {
      const params = { chat_id: DEST_ID, text: msg.message };
      const ents = toApiEntities(msg.entities);
      if (ents) params.entities = ents;
      await botSend('sendMessage', params);
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
      const captEnts = toApiEntities(msg.entities);
      if (captEnts) fd.append('caption_entities', JSON.stringify(captEnts));

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
        } else if (mime.startsWith('image/')) {
          fd.append('photo', buf, { filename: `photo.${ext}`, contentType: mime, knownLength: buf.length });
          await axios.post(`${BOT_URL}/sendPhoto`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
          type = '📷 photo';
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

const pendingGroups = new Map();

async function sendAlbum(client, msgs) {
  const h = new Date().toLocaleTimeString('fr-FR');
  msgs.sort((a, b) => a.id - b.id);
  const items = await Promise.all(msgs.map(async (msg) => {
    if (!msg.media) return null;
    const buf = await client.downloadMedia(msg, {});
    if (!buf) return null;
    const cls  = msg.media.className || '';
    let type = null, mime = 'image/jpeg';
    if (cls === 'MessageMediaPhoto') {
      type = 'photo';
    } else if (cls === 'MessageMediaDocument') {
      mime = msg.media.document?.mimeType || 'application/octet-stream';
      if (mime.startsWith('image/'))      type = 'photo';
      else if (mime.startsWith('video/')) type = 'video';
    }
    if (!type) return null;
    return { type, buf, mime, ext: mime.split('/')[1] || 'bin', caption: msg.message || '', entities: msg.entities };
  }));
  const valid = items.filter(Boolean);
  if (!valid.length) return;

  const fd = new FormData();
  fd.append('chat_id', String(DEST_ID));
  if (valid.length === 1) {
    const it = valid[0];
    if (it.caption) fd.append('caption', it.caption);
    fd.append(it.type, it.buf, { filename: `media.${it.ext}`, contentType: it.mime, knownLength: it.buf.length });
    const method = it.type === 'photo' ? 'sendPhoto' : 'sendVideo';
    await axios.post(`${BOT_URL}/${method}`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
  } else {
    const mediaArr = valid.map((it, i) => {
      const name = `f${i}`;
      fd.append(name, it.buf, { filename: `${it.type}${i}.${it.ext}`, contentType: it.mime, knownLength: it.buf.length });
      const entry = { type: it.type, media: `attach://${name}` };
      if (i === 0 && it.caption) {
        entry.caption = it.caption;
        const ce = toApiEntities(it.entities);
        if (ce) entry.caption_entities = ce;
      }
      return entry;
    });
    fd.append('media', JSON.stringify(mediaArr));
    await axios.post(`${BOT_URL}/sendMediaGroup`, fd, { headers: fd.getHeaders(), maxBodyLength: Infinity });
  }
  console.log(`[${h}] 🖼️ album (${valid.length}) → ${DEST_ID}`);
}

(async () => {
  const client = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, {
    connectionRetries: 10,
    autoReconnect: true,
    deviceModel: 'PC 64bit',
    systemVersion: 'Windows 11',
    appVersion: '4.16.4 x64',
    langCode: 'fr',
    systemLangCode: 'fr-FR',
    useWSS: false,
  });

  try {
    await client.connect();
    const me = await client.getMe();
    console.log('✅ Userbot connecté :', me.username || me.phone);
    console.log('👂 Source :', SOURCE_ID, '→ Destination :', DEST_ID);

    // Sauvegarder la session à jour dans le volume
    saveSession(client);

    // Watchdog : vérifie la connexion toutes les 60s
    setInterval(async () => {
      try {
        await client.getMe();
        saveSession(client); // met à jour la session sauvegardée
      } catch (e) {
        const msg = e.errorMessage || e.message || '';
        console.log('💀 Connexion morte :', msg);
        if (/AUTH_KEY|SESSION_REVOKED|UNAUTHORIZED|UNREGISTERED/i.test(msg)) {
          console.log('⚠️ Session révoquée — envoi alerte SHAFX...');
          await botSend('sendMessage', {
            chat_id: DEST_ID,
            text: '⚠️ Session userbot expirée. Relance node setup.js et envoie la nouvelle SESSION.'
          }).catch(() => {});
        }
        process.exit(1);
      }
    }, 60_000);

    client.addEventHandler(
      async event => {
        const msg = event.message;
        if (msg.groupedId) {
          const gid = String(msg.groupedId);
          if (!pendingGroups.has(gid)) pendingGroups.set(gid, { timer: null, msgs: [] });
          const g = pendingGroups.get(gid);
          g.msgs.push(msg);
          if (g.timer) clearTimeout(g.timer);
          g.timer = setTimeout(async () => {
            pendingGroups.delete(gid);
            await sendAlbum(client, g.msgs).catch(e => console.log('❌ album:', e.message));
          }, 600);
        } else {
          await copy(client, msg);
        }
      },
      new NewMessage({ chats: [SOURCE_ID] })
    );

    process.once('SIGINT',  () => client.disconnect());
    process.once('SIGTERM', () => client.disconnect());

  } catch (err) {
    const msg = err.errorMessage || err.message || '';
    if (/AUTH_KEY|UNREGISTERED|401/i.test(msg) || err.code === 401) {
      console.log('🔑 SESSION expirée au démarrage — envoi alerte...');
      await botSend('sendMessage', {
        chat_id: DEST_ID,
        text: '⚠️ Session userbot expirée. Relance node setup.js et envoie la nouvelle SESSION.'
      }).catch(() => {});
    }
    throw err;
  }
})();
