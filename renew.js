// Renouvellement automatique de session + déploiement Railway
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const readline = require('readline');
const { execSync }       = require('child_process');
const fs                 = require('fs');

const cfg = fs.existsSync('./config.json') ? JSON.parse(fs.readFileSync('./config.json', 'utf8')) : {};
const API_ID   = parseInt(process.env.API_ID   || cfg.api_id   || '2040');
const API_HASH =          process.env.API_HASH || cfg.api_hash || 'b18441a1ff607e10a989891a5462e627';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(r => rl.question(q, r));

(async () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║       HAMZA FX — Renouvellement SESSION   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
    deviceModel: 'PC 64bit',
    systemVersion: 'Windows 11',
    appVersion: '4.16.4 x64',
    langCode: 'fr',
    systemLangCode: 'fr-FR',
  });

  await client.start({
    phoneNumber: async () => await ask('📱 Numéro Telegram (ex: +33612345678) : '),
    phoneCode:   async () => await ask('📨 Code reçu sur Telegram : '),
    password:    async () => await ask('🔐 Mot de passe 2FA (ou Entrée si aucun) : '),
    onError: err => console.log('❌ Erreur:', err.message),
  });

  const session = client.session.save();
  rl.close();
  try { client.disconnect(); } catch (_) {}

  // Écrire la session dans un fichier uploadé avec railway up
  fs.writeFileSync('./session_string.txt', session, 'utf8');
  console.log('\n✅ Session sauvegardée dans session_string.txt');
  console.log('🚀 Déploiement sur Railway (inclut la session)...\n');

  try {
    execSync('railway up --detach', { cwd: __dirname, stdio: 'inherit', shell: true });
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║   ✅ BOT RELANCÉ — tout est bon !         ║');
    console.log('║   Le transfert Suprême → SHAFX reprend.  ║');
    console.log('╚══════════════════════════════════════════╝\n');
  } catch (e) {
    console.log('\n❌ railway up a échoué :', e.message);
    console.log('Lance manuellement dans ce dossier : railway up --detach');
  }

  process.exit(0);
})();
