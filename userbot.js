const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');
const axios              = require('axios');
const fs                 = require('fs');

const cfg = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json', 'utf8')) : {};

const API_ID    = parseInt(process.env.API_ID    || cfg.api_id    || '2040');
const API_HASH  =          process.env.API_HASH  || cfg.api_hash  || 'b18441a1ff607e10a989891a5462e627';
const SOURCE_ID = parseInt(process.env.SOURCE_ID || cfg.source_id || 0);
const DEST_ID   = parseInt(process.env.DEST_ID   || cfg.dest_id   || 0);

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

const ALERT_FLAG = './last_alert.txt';
const ALERT_COOLDOWN = 6 * 60 * 60 * 1000; // 6h
function canSendAlert() {
  try {
    const ts = parseInt(fs.readFileSync(ALERT_FLAG, 'utf8').trim());
    if (Date.now() - ts < ALERT_COOLDOWN) return false;
  } catch {}
  return true;
}
function markAlertSent() {
  try { fs.writeFileSync(ALERT_FLAG, String(Date.now())); } catch {}
}
async function sendExpiredAlert() {
  // désactivé : plus d'envoi de message dans SHAFX, vérif manuelle uniquement
  console.log('⚠️ Session userbot expirée (pas de message envoyé, vérif manuelle).');
}

function saveSession(client) {
  try {
    const dir = '/data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_PATH, client.session.save());
  } catch (e) {
    // pas de volume monté — pas grave, on utilise la var d'env
  }
}

let _lastSavedSession = '';
async function persistSessionToRender(session) {
  const svcId  = process.env.RENDER_SERVICE_ID || '';
  const apiKey = process.env.RENDER_API_KEY    || '';
  if (!svcId || !apiKey || session === _lastSavedSession) return;
  try {
    const existing = await axios.get(
      `https://api.render.com/v1/services/${svcId}/env-vars`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }
    );
    const vars = (existing.data || []).map(e => e.envVar || e);
    const idx  = vars.findIndex(v => v.key === 'SESSION');
    if (idx >= 0) vars[idx].value = session; else vars.push({ key: 'SESSION', value: session });
    await axios.put(
      `https://api.render.com/v1/services/${svcId}/env-vars`,
      vars,
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' } }
    );
    _lastSavedSession = session;
    console.log('💾 Session sauvegardée dans Render');
  } catch (e) {
    console.log('⚠️ persistSessionToRender:', e.response?.data?.message || e.message);
  }
}

let _destEntity = null;
async function getDestEntity(client) {
  if (!_destEntity) _destEntity = await client.getEntity(DEST_ID);
  return _destEntity;
}

async function copy(client, msg) {
  const h = new Date().toLocaleTimeString('fr-FR');
  try {
    if (msg.message && !msg.media) {
      // Envoye depuis le compte (Premium) et non le bot : un bot ne peut pas
      // faire apparaitre un emoji personnalise anime, Telegram le retire silencieusement.
      const dest = await getDestEntity(client);
      await client.sendMessage(dest, { message: msg.message, formattingEntities: msg.entities || [] });
      console.log('[' + h + '] ✉️ texte →', DEST_ID);

    } else if (msg.media) {
      // Envoye depuis le compte (Premium), pas le bot : preserve aussi les
      // emojis animes dans les legendes photo/video (memes raisons que le texte).
      // On passe msg.media tel quel (pas de download/reupload) : Telegram copie
      // le fichier cote serveur via le compte qui vient de le lire.
      const dest = await getDestEntity(client);
      const attrs = msg.media.document?.attributes || [];
      const isSticker = attrs.find(a => a.className === 'DocumentAttributeSticker');
      const isAnim    = attrs.find(a => a.className === 'DocumentAttributeAnimated');
      const mime = msg.media.document?.mimeType || '';
      const type = msg.media.className === 'MessageMediaPhoto' ? '📷 photo'
        : isSticker ? '🌟 sticker'
        : isAnim ? '🎞️ anim'
        : mime.startsWith('video/') ? '🎥 vidéo'
        : mime.startsWith('audio/') ? '🎵 audio'
        : mime.startsWith('image/') ? '📷 photo'
        : '📄 document';

      await client.sendFile(dest, {
        file: msg.media,
        caption: msg.message || '',
        formattingEntities: msg.entities || [],
      });

      console.log('[' + h + '] ' + type + ' →', DEST_ID);
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
  const valid = msgs.filter(m => m.media);
  if (!valid.length) return;

  const dest = await getDestEntity(client);
  const first = valid.find(m => m.message) || valid[0];
  await client.sendFile(dest, {
    file: valid.map(m => m.media),
    caption: first.message || '',
    formattingEntities: first.entities || [],
  });
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

    // Sauvegarde initiale de la session dans Render
    await persistSessionToRender(client.session.save()).catch(() => {});

    // Watchdog : vérifie la connexion toutes les 60s
    setInterval(async () => {
      try {
        await client.getMe();
        saveSession(client);
        await persistSessionToRender(client.session.save()).catch(() => {});
      } catch (e) {
        const msg = e.errorMessage || e.message || '';
        console.log('💀 Connexion morte :', msg);
        if (/AUTH_KEY|SESSION_REVOKED|UNAUTHORIZED|UNREGISTERED/i.test(msg)) {
          console.log('⚠️ Session révoquée — envoi alerte SHAFX...');
          await sendExpiredAlert();
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
      await sendExpiredAlert();
    }
    throw err;
  }
})();
