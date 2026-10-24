import fs from 'fs';
import express from 'express';
import cors from 'cors';
import pino from 'pino';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

const { PHONE, GROUP_ID, SECRET, SITE_URL, PORT = 3000 } = process.env;

let sock = null;
let ready = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();

  const s = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
  });
  sock = s;

  s.ev.on('creds.update', saveCreds);

  let asked = false;
  s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr && !asked && !s.authState.creds.registered && PHONE) {
      asked = true;
      try {
        const code = await s.requestPairingCode(PHONE);
        console.log('PAIRING CODE:', code);
      } catch (e) {
        console.log('Pairing failed:', e.message);
      }
    }

    if (connection === 'open') {
      ready = true;
      console.log('WhatsApp connected');
    }

    if (connection === 'close') {
      ready = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const out = code === DisconnectReason.loggedOut;
      if (out) {
        console.log('Logged out. Resetting and waiting for a new code.');
        fs.rmSync('auth', { recursive: true, force: true });
      }
      setTimeout(start, out ? 10000 : 3000);
    }
  });
}

const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: SITE_URL || false }));

let hits = [];
function limited() {
  const now = Date.now();
  hits = hits.filter((t) => now - t < 60000);
  if (hits.length >= 10) return true;
  hits.push(now);
  return false;
}

const clean = (v, n = 120) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);

app.get('/', (_req, res) => res.send(ready ? 'ok' : 'not connected'));

app.get('/groups', async (req, res) => {
  if (req.query.key !== SECRET) return res.status(401).send('no');
  if (!ready) return res.status(503).send('not connected');
  const groups = await sock.groupFetchAllParticipating();
  res.json(Object.values(groups).map((g) => ({ id: g.id, name: g.subject })));
});

app.post('/order', async (req, res) => {
  if (req.get('x-key') !== SECRET) return res.status(401).json({ error: 'unauthorized' });
  if (!ready || !GROUP_ID) return res.status(503).json({ error: 'not ready' });
  if (limited()) return res.status(429).json({ error: 'too many requests' });

  const b = req.body || {};
  const text = [
    '🚨 הזמנה חדשה',
    `שירות: ${clean(b.type, 40)}`,
    `מוצא: ${clean(b.from)}`,
    `יעד: ${clean(b.to)}`,
    `מחיר: ${clean(b.price, 20)}`,
    `שם: ${clean(b.name, 60)}`,
    `טלפון: ${clean(b.phone, 20)}`,
  ].join('\n');

  try {
    await sock.sendMessage(GROUP_ID, { text });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'send failed' });
  }
});

app.listen(PORT, () => console.log('Server on', PORT));
start();
