const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');

let cfg = { token: '' };
if (fs.existsSync('./config.json')) cfg = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

const TOKEN    = process.env.TOKEN || cfg.token;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || cfg.admin_id || '0');
// SHAFX = DEST_ID (déjà utilisé par les routes de copie ci-dessous) — le bot y est admin.
// SUPRÊME n'accepte aucun bot : jamais posté automatiquement, seulement donné à copier/coller.
const SHAFX_ID = parseInt(process.env.DEST_ID || cfg.dest_id || '0');
// Liste blanche pour les boutons de signal (vide = ouvert à tous, comme le reste du bot).
const SIGNAL_ALLOWED_IDS = (process.env.SIGNAL_ALLOWED_IDS || '')
  .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

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

// ── Boutons de signal (pour l'ami) ────────────────────────────────────────────
// SHAFX : posté automatiquement par le bot (déjà admin là-bas).
// SUPRÊME : jamais touché par le bot — juste renvoyé en copiable, à coller à la main.
const SIGNAL_TEXTS = {
  sig_buy:        'BUY XAUUSD NOW',
  sig_sell:       'SELL XAUUSD NOW',
  sig_be:         'METTEZ VOUS BE',
  sig_close_high: 'CLOTUREZ LES POSITIONS HAUTES ET LAISSEZ TOURNER LES BASSES EN LES METTANT BE',
  sig_close_low:  'CLOTUREZ LES POSITIONS BASSES ET LAISSEZ TOURNER LES HAUTES EN LES METTANT BE',
};

function isSignalAllowed(ctx) {
  return !SIGNAL_ALLOWED_IDS.length || SIGNAL_ALLOWED_IDS.includes(ctx.from?.id);
}

const signalKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('🟢 BUY XAUUSD', 'sig_buy'), Markup.button.callback('🔴 SELL XAUUSD', 'sig_sell')],
  [Markup.button.callback('🛡️ BE', 'sig_be')],
  [Markup.button.callback('⬆️ Clôture hautes (BUY)', 'sig_close_high')],
  [Markup.button.callback('⬇️ Clôture basses (SELL)', 'sig_close_low')],
]);

bot.command('signal', ctx => {
  if (!isSignalAllowed(ctx)) return;
  ctx.reply('📡 Panneau de signal', signalKeyboard);
});

for (const key of Object.keys(SIGNAL_TEXTS)) {
  bot.action(key, async ctx => {
    if (!isSignalAllowed(ctx)) return ctx.answerCbQuery();
    const text = SIGNAL_TEXTS[key];
    try {
      await bot.telegram.sendMessage(SHAFX_ID, text);
      await ctx.answerCbQuery('Envoyé dans SHAFX ✅');
    } catch (e) {
      await ctx.answerCbQuery('❌ Échec SHAFX', { show_alert: true });
      console.log('❌ signal → SHAFX :', e.message);
    }
    await ctx.reply('📋 Colle ça dans SUPRÊME :\n\n`' + text + '`', { parse_mode: 'Markdown' });
  });
}

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

bot.launch({ allowedUpdates: ['message', 'channel_post', 'callback_query'] });
console.log('✅ HAMZA FX lancé — ' + routes.length + ' route(s) active(s)');
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
