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

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered && PHONE) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE);
        console.log('PAIRING CODE:', code);
      } catch (e) {
        console.log('Pairing failed:', e.message);
      }
    }, 3000);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      ready = true;
      console.log('WhatsApp connected');
    }
    if (connection ===
