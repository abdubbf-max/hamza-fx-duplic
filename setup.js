// Lancer UNE SEULE FOIS pour générer la SESSION STRING
// node setup.js

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const readline = require('readline');
const fs = require('fs');

const cfg = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json', 'utf8')) : {};
// Credentials Telegram Desktop (publics, pas besoin de my.telegram.org)
const API_ID   = parseInt(process.env.API_ID   || cfg.api_id   || '2040');
const API_HASH =          process.env.API_HASH || cfg.api_hash || 'b18441a1ff607e10a989891a5462e627';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

(async () => {
  console.log('=== HAMZA FX — Génération de session ===\n');
  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, { connectionRetries: 5 });

  await client.start({
    phoneNumber:  async () => await ask('📱 Ton numéro Telegram (ex: +33612345678) : '),
    phoneCode:    async () => await ask('📨 Code reçu par Telegram : '),
    password:     async () => await ask('🔐 Mot de passe 2FA (si activé, sinon appuie sur Entrée) : '),
    onError: err => console.log('Erreur:', err.message),
  });

  const session = client.session.save();
  console.log('\n✅ Session générée ! Envoie ce texte à ton ami :\n');
  console.log('SESSION=' + session);
  console.log('\n(Il le met dans les variables Railway)');

  rl.close();
  await client.disconnect();
})();
