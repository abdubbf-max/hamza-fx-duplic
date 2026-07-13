// Serveur web PWA pour renouveler la session Telegram depuis l'iPhone
const http = require('http');
const zlib = require('zlib');
const fs   = require('fs');
const { TelegramClient, Api } = require('telegram');
const { StringSession }       = require('telegram/sessions');

const PORT     = parseInt(process.env.PORT || '3000');
const PIN      = process.env.RENEW_PIN || '0000';
const API_ID   = parseInt(process.env.API_ID   || '2040');
const API_HASH = process.env.API_HASH || 'b18441a1ff607e10a989891a5462e627';

let tgClient = null;
let tgPhone  = null;
let tgHash   = null;

// ── Icône PNG 180×180 générée sans dépendance externe ────────────────────────
function makePNG(w, h, r, g, b) {
  const T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    T[n] = c;
  }
  function crc(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const L = Buffer.alloc(4); L.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const C = Buffer.alloc(4); C.writeUInt32BE(crc(td));
    return Buffer.concat([L, td, C]);
  }
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1+x*3]=r; row[2+x*3]=g; row[3+x*3]=b; }
  const raw = Buffer.concat(Array(h).fill(row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=2;
  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const ICON = makePNG(180, 180, 0x22, 0xC5, 0x5E);

// ── Auth Telegram en deux étapes ─────────────────────────────────────────────
async function tgStart(phone) {
  if (tgClient) try { tgClient.disconnect(); } catch (_) {}
  tgClient = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 3,
    deviceModel: 'PC 64bit', systemVersion: 'Windows 11',
    appVersion: '4.16.4 x64', langCode: 'fr',
  });
  await tgClient.connect();
  const r = await tgClient.invoke(new Api.auth.SendCode({
    phoneNumber: phone, apiId: API_ID, apiHash: API_HASH,
    settings: new Api.CodeSettings({ allowAppHash: true }),
  }));
  tgPhone = phone;
  tgHash  = r.phoneCodeHash;
}

async function tgVerify(code) {
  await tgClient.invoke(new Api.auth.SignIn({
    phoneNumber: tgPhone, phoneCodeHash: tgHash, phoneCode: code,
  }));
  return saveAndSignal();
}

async function tgPassword(pw) {
  const info = await tgClient.invoke(new Api.account.GetPassword());
  let computeCheck;
  try { computeCheck = require('telegram/Password').computeCheck; } catch (_) {
    try { computeCheck = require('telegram/dist/Password').computeCheck; } catch (_2) {
      throw new Error('2FA non supporté dans cette version — désactive-le temporairement.');
    }
  }
  const check = await computeCheck(info, pw);
  await tgClient.invoke(new Api.auth.CheckPassword({ password: check }));
  return saveAndSignal();
}

function saveAndSignal() {
  const session = tgClient.session.save();
  const old = tgClient;
  tgClient = null; tgPhone = null; tgHash = null;
  // Force-stop gramjs internal loops before they generate more TIMEOUT errors
  try { old._userConnected = false; } catch (_) {}
  try { old.disconnect(); } catch (_) {}

  // Volume Railway en priorité, sinon fichier local
  for (const p of ['/data/session.txt', './session_string.txt']) {
    try {
      const dir = p.split('/').slice(0, -1).join('/') || '.';
      if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, session, 'utf8');
      console.log('💾 Session écrite :', p);
      break;
    } catch (_) {}
  }
  // Signal pour main.js → redémarre userbot dans 3s
  try { fs.writeFileSync('./session_renewed.flag', '1'); } catch (_) {}
  return session;
}

// ── HTML / PWA ────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="HamzaFX">
<meta name="theme-color" content="#0d0d0d">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon.png">
<title>Hamza FX</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{--bg:#0d0d0d;--s:#161616;--b:#252525;--g:#22c55e;--g2:#16a34a;--t:#f0f0f0;--sub:#6b7280;--er:#f87171;--r:14px}
body{background:var(--bg);color:var(--t);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:var(--s);border:1px solid var(--b);border-radius:22px;padding:28px 22px;width:100%;max-width:340px}
.head{text-align:center;margin-bottom:26px}
.icon{width:62px;height:62px;border-radius:17px;background:linear-gradient(140deg,var(--g),#0f7a38);display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:10px}
.head h1{font-size:19px;font-weight:700;letter-spacing:-.3px}
.head p{font-size:12px;color:var(--sub);margin-top:3px}
.step{display:none}.step.on{display:block}
.lbl{font-size:11px;font-weight:600;color:var(--sub);letter-spacing:.5px;text-transform:uppercase;margin-bottom:7px}
input{width:100%;background:#1d1d1d;border:1.5px solid var(--b);border-radius:var(--r);padding:13px 15px;color:var(--t);font-size:16px;font-family:inherit;outline:none;transition:border-color .15s;-webkit-appearance:none;appearance:none}
input:focus{border-color:var(--g)}
input::placeholder{color:var(--sub)}
.btn{width:100%;background:var(--g);color:#fff;border:none;border-radius:var(--r);padding:14px;font-size:15px;font-weight:600;cursor:pointer;margin-top:14px;transition:background .15s;font-family:inherit;display:block}
.btn:active{background:var(--g2)}
.btn:disabled{background:#0e3320;color:#3d6b4f;cursor:default}
.er{background:#1a0a0a;border:1px solid #3d1010;border-radius:10px;padding:10px 13px;font-size:13px;color:var(--er);margin-top:12px;display:none;line-height:1.4}
.hint{font-size:12px;color:var(--sub);margin-top:10px;text-align:center;line-height:1.5}
.ok-ring{width:68px;height:68px;border-radius:50%;background:linear-gradient(135deg,var(--g),#0f7a38);display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 18px;animation:pop .45s cubic-bezier(.34,1.56,.64,1) both}
@keyframes pop{from{transform:scale(0);opacity:0}to{transform:scale(1);opacity:1}}
.ok-t{font-size:20px;font-weight:700;text-align:center}
.ok-s{font-size:13px;color:var(--sub);text-align:center;margin-top:7px;line-height:1.5}
.spin{width:15px;height:15px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:rot .65s linear infinite;display:inline-block;vertical-align:middle;margin-right:6px}
@keyframes rot{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
  <div class="head">
    <div class="icon">⚡</div>
    <h1>Hamza FX</h1>
    <p>Renouvellement de session</p>
  </div>

  <div class="step on" id="s2">
    <div class="lbl">Numéro Telegram</div>
    <input id="phone" type="tel" value="+33756938876" inputmode="tel" autocomplete="tel">
    <button class="btn" id="b2" onclick="step2()">Envoyer le code</button>
    <p class="hint">Le code arrivera dans ton app Telegram</p>
    <div class="er" id="e2"></div>
  </div>

  <div class="step" id="s3">
    <div class="lbl">Code Telegram</div>
    <input id="code" type="text" inputmode="numeric" placeholder="1 2 3 4 5" maxlength="5" autocomplete="one-time-code">
    <button class="btn" id="b3" onclick="step3()">Valider</button>
    <p class="hint">Entre le code reçu dans Telegram</p>
    <div class="er" id="e3"></div>
  </div>

  <div class="step" id="s4">
    <div class="lbl">Mot de passe 2FA</div>
    <input id="pw" type="password" placeholder="Mot de passe" autocomplete="current-password">
    <button class="btn" id="b4" onclick="step4()">Valider</button>
    <div class="er" id="e4"></div>
  </div>

  <div class="step" id="s5">
    <div class="ok-ring">✓</div>
    <div class="ok-t">Session renouvelée&nbsp;!</div>
    <p class="ok-s">Le bot redémarre automatiquement.<br>Les transferts reprennent dans quelques secondes.</p>
  </div>
</div>
<script>
let ph='';
const $=id=>document.getElementById(id);
const show=id=>{document.querySelectorAll('.step').forEach(e=>e.classList.remove('on'));$(id).classList.add('on')};
const er=(id,m)=>{const e=$(id);e.textContent=m;e.style.display='block'};
const ok=id=>{$(id).style.display='none'};
const load=(b,on,lbl)=>{b.disabled=on;b.innerHTML=on?'<span class="spin"></span>Patiente…':lbl};
const post=(url,d)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}).then(r=>r.json());

async function step2(){
  ok('e2'); ph=$('phone').value.trim();
  if(!ph){er('e2','Entre ton numéro.');return;}
  const b=$('b2'); load(b,true,'Envoyer le code');
  try{
    const d=await post('/api/start',{phone:ph});
    if(!d.ok){er('e2',d.error||'Erreur');load(b,false,'Envoyer le code');return;}
    show('s3'); setTimeout(()=>$('code').focus(),120);
  }catch(e){er('e2','Erreur réseau');load(b,false,'Envoyer le code');}
}
async function step3(){
  ok('e3'); const c=$('code').value.trim();
  if(!c){er('e3','Entre le code.');return;}
  const b=$('b3'); load(b,true,'Valider');
  try{
    const d=await post('/api/verify',{phone:ph,code:c});
    if(d.need2fa){show('s4');return;}
    if(!d.ok){er('e3',d.error||'Code incorrect');load(b,false,'Valider');return;}
    show('s5');
  }catch(e){er('e3','Erreur réseau');load(b,false,'Valider');}
}
async function step4(){
  ok('e4'); const pw=$('pw').value;
  if(!pw){er('e4','Entre le mot de passe.');return;}
  const b=$('b4'); load(b,true,'Valider');
  try{
    const d=await post('/api/2fa',{password:pw});
    if(!d.ok){er('e4',d.error||'Incorrect');load(b,false,'Valider');return;}
    show('s5');
  }catch(e){er('e4','Erreur réseau');load(b,false,'Valider');}
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;
  const id=document.querySelector('.step.on').id;
  if(id==='s2')step2();if(id==='s3')step3();if(id==='s4')step4();
});
</script>
</body>
</html>`;

// ── Serveur HTTP ──────────────────────────────────────────────────────────────
function body(req) {
  return new Promise((res, rej) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 2000) rej(new Error('too large')); });
    req.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('bad json')); } });
  });
}
function json(res, st, obj) {
  res.writeHead(st, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const MANIFEST = JSON.stringify({
  name: 'Hamza FX — Session', short_name: 'HamzaFX',
  start_url: '/', display: 'standalone',
  background_color: '#0d0d0d', theme_color: '#0d0d0d',
  icons: [{ src: '/icon.png', sizes: '180x180', type: 'image/png' }],
});

// Supprime le spam TIMEOUT de gramjs dans les logs Railway
const _ce = console.error.bind(console);
console.error = (...a) => {
  const s = a.join(' ');
  if (s.includes('TIMEOUT') || s.includes('_updateLoop') || s.includes('updates.js')) return;
  _ce(...a);
};
process.on('unhandledRejection', reason => {
  if (/TIMEOUT/i.test(String(reason?.message || reason))) return;
  console.error('Unhandled rejection:', reason);
});

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(HTML);
  }
  if (url === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(MANIFEST);
  }
  if (url === '/icon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=86400' });
    return res.end(ICON);
  }

  if (req.method !== 'POST') { res.writeHead(404); return res.end(); }

  let b;
  try { b = await body(req); } catch { return json(res, 400, { ok: false, error: 'Requête invalide.' }); }

  if (url === '/api/start') {
    if (!b.phone) return json(res, 400, { ok: false, error: 'Numéro manquant.' });
    try   { await tgStart(b.phone); json(res, 200, { ok: true }); }
    catch (e) { json(res, 500, { ok: false, error: e.message }); }
    return;
  }

  if (url === '/api/verify') {
    if (!tgClient) return json(res, 400, { ok: false, error: 'Session expirée, recommence.' });
    try {
      await tgVerify(b.code);
      json(res, 200, { ok: true });
    } catch (e) {
      if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') return json(res, 200, { ok: false, need2fa: true });
      json(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  if (url === '/api/2fa') {
    try   { await tgPassword(b.password); json(res, 200, { ok: true }); }
    catch (e) { json(res, 500, { ok: false, error: e.message }); }
    return;
  }

  res.writeHead(404); res.end();
}).listen(PORT, () => {
  const warn = PIN === '0000' ? ' ⚠️  Défaut — ajoute RENEW_PIN dans Railway !' : '';
  console.log(`🌐 Renew UI actif → port ${PORT}${warn}`);

  // Auto-ping toutes les 14 min pour empêcher Render de dormir
  const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const _ping = selfUrl.startsWith('https') ? require('https') : require('http');
  setInterval(() => {
    _ping.get(selfUrl, res => {
      res.resume();
      console.log(`🏓 Keep-alive → ${res.statusCode}`);
    }).on('error', () => {});
  }, 14 * 60 * 1000);
});
