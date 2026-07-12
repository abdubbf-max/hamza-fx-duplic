const { spawn } = require('child_process');
const fs = require('fs');

let userbotProc = null;
let userbotTimer = null;

function run(file, delay) {
  const p = spawn('node', [file], { stdio: 'inherit' });
  if (file === 'userbot.js') userbotProc = p;
  p.on('exit', code => {
    if (file === 'userbot.js') userbotProc = null;
    console.log(`[${file}] arrêté (code ${code}), redémarrage dans ${delay/1000}s...`);
    const t = setTimeout(() => run(file, delay), delay);
    if (file === 'userbot.js') userbotTimer = t;
  });
}

// Détecte le renouvellement de session → redémarre le userbot immédiatement
setInterval(() => {
  if (fs.existsSync('./session_renewed.flag')) {
    try { fs.unlinkSync('./session_renewed.flag'); } catch (_) {}
    if (userbotProc) {
      console.log('🔄 Nouvelle session détectée — redémarrage du userbot...');
      userbotProc.kill('SIGTERM');
    } else {
      console.log('🔄 Nouvelle session détectée — relance immédiate du userbot...');
      if (userbotTimer) { clearTimeout(userbotTimer); userbotTimer = null; }
      run('userbot.js', 3600000);
    }
  }
}, 5000);

run('index.js',         70000);
run('userbot.js',     3600000);
run('renew-server.js',  5000);
