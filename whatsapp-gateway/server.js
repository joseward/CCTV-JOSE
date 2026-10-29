const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// Enable CORS so the CCTV viewer UI can request QR and status directly
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
let sock = null;
let currentQrDataUrl = null;
let isConnected = false;
let connectedUser = null;

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true, // Also prints to console
    browser: ['CCTV Unified Monitor', 'Desktop', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        currentQrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        isConnected = false;
        connectedUser = null;
        console.log('[WhatsApp Gateway] Nuevo código QR generado para vinculación.');
      } catch (err) {
        console.error('Error generating QR:', err);
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      isConnected = false;
      connectedUser = null;
      console.log(`[WhatsApp Gateway] Conexión cerrada (Código: ${statusCode}). Reconectando: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log('[WhatsApp Gateway] Sesión cerrada formalmente. Limpiando credenciales...');
        try {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        } catch (e) {}
        currentQrDataUrl = null;
        setTimeout(startWhatsApp, 2000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQrDataUrl = null;
      const userJid = sock.user?.id || '';
      connectedUser = userJid.split(':')[0] || userJid.split('@')[0];
      console.log(`[WhatsApp Gateway] ✓ Conectado exitosamente como: +${connectedUser}`);
    }
  });
}

// Helper to resolve exact WhatsApp JID using onWhatsApp query
async function findValidJid(sock, inputNumber) {
  let clean = inputNumber.toString().replace(/[^0-9]/g, '');
  let candidates = [];

  if (clean.length === 10) {
    // 10 digits national (Mexico): cell phones in WhatsApp are usually 521 + 10 digits
    candidates.push(`521${clean}@s.whatsapp.net`);
    candidates.push(`52${clean}@s.whatsapp.net`);
  } else if (clean.startsWith('521') && clean.length === 13) {
    const local10 = clean.substring(3);
    candidates.push(`521${local10}@s.whatsapp.net`);
    candidates.push(`52${local10}@s.whatsapp.net`);
  } else if (clean.startsWith('52') && clean.length === 12) {
    const local10 = clean.substring(2);
    candidates.push(`521${local10}@s.whatsapp.net`);
    candidates.push(`52${local10}@s.whatsapp.net`);
  } else {
    candidates.push(`${clean}@s.whatsapp.net`);
  }

  // 1. Query WhatsApp servers to find which JID actually exists
  try {
    for (const cand of candidates) {
      const results = await sock.onWhatsApp(cand);
      if (results && Array.isArray(results) && results.length > 0) {
        const found = results.find(r => r.exists);
        if (found && found.jid) {
          console.log(`[WhatsApp Gateway] ✓ Número ${inputNumber} verificado en WhatsApp con JID: ${found.jid}`);
          return found.jid;
        }
      }
    }
  } catch (err) {
    console.warn('[WhatsApp Gateway] Advertencia al consultar onWhatsApp:', err?.message || err);
  }

  // 2. Fallback heuristic for Mexico: Always prefer 521 for mobile WhatsApp delivery
  if (clean.length === 10) return `521${clean}@s.whatsapp.net`;
  if (clean.startsWith('52') && clean.length === 12) return `521${clean.substring(2)}@s.whatsapp.net`;
  if (clean.startsWith('521') && clean.length === 13) return `${clean}@s.whatsapp.net`;
  return `${clean}@s.whatsapp.net`;
}

// 1. Status endpoint
app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    user: connectedUser ? `+${connectedUser}` : null,
    hasQr: !!currentQrDataUrl,
  });
});

// 2. QR code endpoint
app.get('/qr', (req, res) => {
  res.json({
    connected: isConnected,
    user: connectedUser ? `+${connectedUser}` : null,
    qr: currentQrDataUrl,
  });
});

// 2.1 Validate number endpoint
app.get('/validate-number', async (req, res) => {
  const number = req.query.number || req.query.phone;
  if (!number) return res.status(400).json({ valid: false, error: 'Número no proporcionado' });
  if (!isConnected || !sock) return res.status(503).json({ valid: false, error: 'WhatsApp no está vinculado' });

  try {
    const jid = await findValidJid(sock, number);
    res.json({ valid: true, jid, number });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// 3. Send message endpoint (Supports standard Baileys & Evolution formats)
app.post(['/send', '/message/sendText'], async (req, res) => {
  const number = req.body.number || req.body.phone || req.body.to;
  const text = req.body.text || req.body.message || '';

  if (!isConnected || !sock) {
    return res.status(503).json({
      success: false,
      error: 'WhatsApp no está vinculado. Escanea el código QR en la aplicación.',
    });
  }

  if (!number || !text) {
    return res.status(400).json({
      success: false,
      error: 'Faltan parámetros: se requiere "number" y "text".',
    });
  }

  try {
    const targetJid = await findValidJid(sock, number);
    console.log(`[WhatsApp Gateway] Enviando mensaje a ${targetJid}...`);

    const sent = await sock.sendMessage(targetJid, { text });
    console.log(`[WhatsApp Gateway] ✓ Mensaje enviado exitosamente. ID: ${sent?.key?.id}`);

    res.json({
      success: true,
      messageId: sent?.key?.id,
      to: targetJid.split('@')[0],
      jid: targetJid,
    });
  } catch (err) {
    console.error('[WhatsApp Gateway] Error al enviar mensaje:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Error interno al enviar mensaje',
    });
  }
});

// 4. Logout / Unlink endpoint
app.post('/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
    }
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    isConnected = false;
    connectedUser = null;
    currentQrDataUrl = null;
    setTimeout(startWhatsApp, 1500);
    res.json({ success: true, message: 'WhatsApp desvinculado con éxito' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

process.on('uncaughtException', (err) => {
  console.error('[WhatsApp Gateway] Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[WhatsApp Gateway] Unhandled Rejection:', err);
});

const PORT = process.env.PORT || 8120;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`====================================================`);
  console.log(`[WhatsApp Gateway Local] Servidor activo en http://127.0.0.1:${PORT}`);
  console.log(`====================================================`);
  startWhatsApp();
});
