'use strict';
/* Décode un fichier audio en PCM mono float32 à 48 kHz, sans dépendance : Chrome ou Edge sans écran, OfflineAudioContext, serveur local jetable.
   node tests/decode-pcm.js audio/x.ogg sortie.f32
   Le PCM n'a pas sa place dans le projet : le garder ailleurs, tests/vraies-voix.js le lit. */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const [src, dst] = process.argv.slice(2);
if (!src || !dst) { console.error('usage : node tests/decode-pcm.js entree sortie.f32'); process.exit(2); }
const nav = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
if (!nav) { console.error('ni Chrome ni Edge trouvé'); process.exit(2); }

const PAGE = `<script>(async()=>{try{
  const a=await(await fetch('/audio')).arrayBuffer(),b=await new OfflineAudioContext(1,48000,48000).decodeAudioData(a),n=b.length,m=new Float32Array(n);
  for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c);for(let i=0;i<n;i++)m[i]+=d[i]/b.numberOfChannels;}
  await fetch('/pcm',{method:'POST',body:m});
}catch(e){await fetch('/erreur',{method:'POST',body:String(e)});}})()</script>`;
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'decode-')); let nv;
const fin = code => { if (nv) nv.kill(); srv.close(); setTimeout(() => { try { fs.rmSync(dossier, { recursive: true, force: true }); } catch {} process.exit(code); }, 500); };
const srv = http.createServer((q, r) => {
  if (q.url === '/') return r.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  if (q.url === '/audio') return r.end(fs.readFileSync(src));
  if (q.method !== 'POST') return r.writeHead(404).end();
  const l = []; q.on('data', d => l.push(d)); q.on('end', () => {
    r.end('ok'); const b = Buffer.concat(l);
    if (q.url === '/pcm') { fs.writeFileSync(dst, b); console.log(`${dst} : ${(b.length / 4 / 48000).toFixed(1)} s à 48 kHz`); fin(0); } else { console.error(b.toString()); fin(1); }
  });
});
srv.listen(0, '127.0.0.1', () => { nv = spawn(nav, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + dossier, `http://127.0.0.1:${srv.address().port}/`], { stdio: 'ignore' }); });
setTimeout(() => { console.error('délai dépassé'); fin(1); }, 90000).unref();
