const { Telegraf } = require('telegraf');
const fs = require('fs');

let cfg = { token: '' };
if (fs.existsSync('./config.json')) cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const TOKEN    = process.env.TOKEN || cfg.token;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || cfg.admin_id || '0');

if (!TOKEN || TOKEN === 'METS_TON_TOKEN_ICI') { console.log('❌ Token manquant'); process.exit(1); }

// Routes actives : [{ src: -123, dst: -456 }, ...]
let routes = [];
const ROUTES_FILE = './routes.json';
if (fs.existsSync(ROUTES_FILE)) {
  routes = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
  console.log('📋 Routes chargées :', routes.length);
}
if (process.env.ROUTES) {
  try { routes = JSON.parse(process.env.ROUTES); console.log('📋 Routes depuis env :', routes.length); } catch {}
}

function saveRoutes() {
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2));
}

function isAdmin(ctx) {
  return !ADMIN_ID || ctx.from?.id === ADMIN_ID;
}

const bot = new Telegraf(TOKEN);

// ── Commandes admin ───────────────────────────────────────────────────────────

// /start — affiche l'ID du chat actuel
bot.command('start', ctx => {
  const id = ctx.chat.id;
  const titre = ctx.chat.title || ctx.chat.username || 'privé';
  ctx.reply('👋 HAMZA FX\n\n📌 ID de ce chat : ' + id + '\nNom : ' + titre);
});

// /id — affiche l'ID du chat (utile dans les groupes)
bot.command('id', ctx => {
  ctx.reply('🆔 ID : ' + ctx.chat.id + '\n📌 ' + (ctx.chat.title || 'privé'));
});

// /add <source_id> <dest_id> — ajouter une route
bot.command('add', ctx => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) { ctx.reply('Usage : /add <source\\_id> <dest\\_id>', { parse_mode: 'Markdown' }); return; }
  const src = parseInt(parts[1]);
  const dst = parseInt(parts[2]);
  if (isNaN(src) || isNaN(dst)) { ctx.reply('❌ IDs invalides'); return; }
  if (routes.find(r => r.src === src)) { ctx.reply('⚠️ Cette source existe déjà. Fais /remove ' + src + ' d\'abord.'); return; }
  routes.push({ src, dst });
  saveRoutes();
  ctx.reply('✅ Route ajoutée :\n📥 `' + src + '`\n📤 `' + dst + '`', { parse_mode: 'Markdown' });
  console.log('➕ Route ajoutée :', src, '→', dst);
});

// /remove <source_id> — supprimer une route
bot.command('remove', ctx => {
  if (!isAdmin(ctx)) return;
  const src = parseInt(ctx.message.text.split(' ')[1]);
  const before = routes.length;
  routes = routes.filter(r => r.src !== src);
  saveRoutes();
  ctx.reply(routes.length < before ? '🗑️ Route supprimée.' : '❌ Route introuvable.');
});

// /list — lister les routes actives
bot.command('list', ctx => {
  if (!isAdmin(ctx)) return;
  if (!routes.length) { ctx.reply('Aucune route active.'); return; }
  const lines = routes.map((r, i) => (i+1) + '. `' + r.src + '` → `' + r.dst + '`').join('\n');
  ctx.reply('📋 Routes actives :\n' + lines, { parse_mode: 'Markdown' });
});

// ── Copie des messages ────────────────────────────────────────────────────────
const copy = async (msg) => {
  const route = routes.find(r => r.src === msg.chat.id);
  if (!route) return;
  const tg = bot.telegram;
  const h  = new Date().toLocaleTimeString('fr-FR');
  try {
    if (msg.text) {
      await tg.sendMessage(route.dst, msg.text, { entities: msg.entities });
    } else if (msg.photo) {
      await tg.sendPhoto(route.dst, msg.photo[msg.photo.length-1].file_id, { caption: msg.caption, caption_entities: msg.caption_entities });
    } else if (msg.video) {
      await tg.sendVideo(route.dst, msg.video.file_id, { caption: msg.caption, caption_entities: msg.caption_entities });
    } else if (msg.document) {
      await tg.sendDocument(route.dst, msg.document.file_id, { caption: msg.caption, caption_entities: msg.caption_entities });
    } else if (msg.audio) {
      await tg.sendAudio(route.dst, msg.audio.file_id, { caption: msg.caption });
    } else if (msg.voice) {
      await tg.sendVoice(route.dst, msg.voice.file_id);
    } else if (msg.sticker) {
      await tg.sendSticker(route.dst, msg.sticker.file_id);
    } else if (msg.animation) {
      await tg.sendAnimation(route.dst, msg.animation.file_id, { caption: msg.caption });
    } else if (msg.video_note) {
      await tg.sendVideoNote(route.dst, msg.video_note.file_id);
    } else {
      await tg.forwardMessage(route.dst, msg.chat.id, msg.message_id);
    }
    console.log('[' + h + '] ✉️ ' + msg.chat.id + ' → ' + route.dst + ' : ' + (msg.text || '[media]').substring(0, 50));
  } catch (e) {
    console.log('[' + h + '] ❌', e.message);
  }
};

bot.on('message',      ctx => copy(ctx.message));
bot.on('channel_post', ctx => copy(ctx.channelPost));

bot.launch({ allowedUpdates: ['message', 'channel_post'] });
console.log('✅ HAMZA FX lancé — ' + routes.length + ' route(s) active(s)');
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
