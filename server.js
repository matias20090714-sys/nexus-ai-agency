const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const PORT = process.env.PORT || 5180;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Active Baileys sessions store
const activeSessions = {};

// Ensure sessions storage directory exists
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// WhatsApp Multi-Device Session Initializer (Baileys)
async function getOrInitBaileysSession(sessionId = 'agency_master_1', phoneForPairingCode = null, forceNew = false) {
  const sessionFolder = path.join(SESSIONS_DIR, sessionId);
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
  }

  if (forceNew) {
    if (activeSessions[sessionId]?.sock) {
      try { activeSessions[sessionId].sock.end(); } catch (e) {}
    }
    try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(sessionFolder, { recursive: true });
    delete activeSessions[sessionId];
  }

  if (activeSessions[sessionId] && activeSessions[sessionId].sock) {
    if (phoneForPairingCode && !activeSessions[sessionId].connected) {
      try {
        const clean = phoneForPairingCode.replace(/\D/g, '');
        const code = await activeSessions[sessionId].sock.requestPairingCode(clean);
        activeSessions[sessionId].pairingCode = code;
        return activeSessions[sessionId];
      } catch (e) {
        console.error(`[Baileys - ${sessionId}] Error solicitando pairing code en sesión activa:`, e.message);
      }
    }
    return activeSessions[sessionId];
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  
  // Get latest WhatsApp Web version to prevent 408/401 rejections
  let waVersion = [2, 3000, 1043857760];
  try {
    const versionData = await fetchLatestBaileysVersion();
    if (versionData && versionData.version) {
      waVersion = versionData.version;
    }
  } catch (err) {
    console.log(`[Baileys - ${sessionId}] Usando versión WA fallback.`);
  }

  const sessionData = activeSessions[sessionId] || {
    sock: null,
    qr: null,
    qrImage: null,
    pairingCode: null,
    connected: false,
    phone: null,
    userName: null,
    status: 'initializing'
  };
  activeSessions[sessionId] = sessionData;

  const sock = makeWASocket({
    version: waVersion,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.windows('Desktop'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    emitOwnEvents: true
  });
  sessionData.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sessionData.qr = qr;
      sessionData.status = 'qr_ready';
      try {
        sessionData.qrImage = await QRCode.toDataURL(qr, {
          width: 360,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        });
        console.log(`[Baileys - ${sessionId}] ⚡ Código QR de WhatsApp Web Oficial generado (Listo para escanear).`);
      } catch (err) {
        console.error('Error generando QR Image:', err);
      }
    }

    if (connection === 'open') {
      sessionData.connected = true;
      sessionData.qr = null;
      sessionData.qrImage = null;
      sessionData.pairingCode = null;
      sessionData.status = 'connected';
      
      const userJid = sock.user ? sock.user.id : '';
      const cleanPhone = userJid.split(':')[0] || userJid.split('@')[0];
      sessionData.phone = cleanPhone;
      sessionData.userName = (sock.user && sock.user.name) || 'WhatsApp Empresa';
      
      console.log(`[Baileys - ${sessionId}] 🎉 ¡WhatsApp Real Vinculado con éxito! Línea: +${cleanPhone}`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const wasConnected = sessionData.connected;
      sessionData.connected = false;

      console.log(`[Baileys - ${sessionId}] Conexión cerrada (${statusCode || 'unknown'}).`);

      if (activeSessions[sessionId]) {
        activeSessions[sessionId].sock = null;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        sessionData.status = 'logged_out';
        try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch (e) {}
      } else {
        sessionData.status = 'reconnecting';
      }

      // Automatically re-initialize to keep QR or pairing code always alive and ready
      setTimeout(() => {
        getOrInitBaileysSession(sessionId).catch(e => console.error('Error reiniciando sesión Baileys:', e.message));
      }, 2000);
    }
  });

  // Listen to Real Incoming Messages & Auto-Respond with AI
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const senderJid = msg.key.remoteJid;
          // Avoid replying to status broadcast or groups
          if (senderJid && !senderJid.includes('@g.us') && !senderJid.includes('status@broadcast')) {
            const senderNumber = senderJid.split('@')[0];
            const textBody = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            console.log(`[Baileys - ${sessionId}] 📩 Mensaje entrante de +${senderNumber}: "${textBody}"`);

            if (textBody && textBody.trim()) {
              try {
                // Simulate human delay (1.2s)
                await new Promise(r => setTimeout(r, 1200));
                const aiReply = await generateAiAgentResponse(textBody, senderNumber);
                if (aiReply && sock) {
                  await sock.sendMessage(senderJid, { text: aiReply });
                  console.log(`[Baileys - ${sessionId}] 🤖 IA respondió a +${senderNumber}: "${aiReply.slice(0, 40)}..."`);
                }
              } catch (replyErr) {
                console.error(`[Baileys - ${sessionId}] Error al auto-responder:`, replyErr.message);
              }
            }
          }
        }
      }
    }
  });

  if (phoneForPairingCode) {
    setTimeout(async () => {
      try {
        const clean = phoneForPairingCode.replace(/\D/g, '');
        const code = await sock.requestPairingCode(clean);
        sessionData.pairingCode = code;
        console.log(`[Baileys - ${sessionId}] 🔢 Código 8-dígitos generado para +${clean}: ${code}`);
      } catch (e) {
        console.error(`[Baileys - ${sessionId}] Error solicitando pairing code:`, e.message);
      }
    }, 1500);
  }

  return sessionData;
}

// AI Auto-Responder Engine
let customAiKey = process.env.GEMINI_API_KEY || '';

async function generateAiAgentResponse(userText, senderPhone) {
  const text = (userText || '').toLowerCase().trim();
  if (!text) return null;

  // 1. If Gemini API key is configured, call Gemini 2.5 Flash
  if (customAiKey) {
    try {
      const prompt = `Eres un asistente de inteligencia artificial profesional para una agencia de automatización y servicios. Responde de forma amable, vendedora, concisa (máximo 2 a 3 párrafos cortos) y en español neutro al siguiente mensaje de WhatsApp de un cliente (+${senderPhone}):\n\nMensaje del cliente: "${userText}"\n\nRespuesta:`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${customAiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (response.ok) {
        const json = await response.json();
        const candidate = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) return candidate.trim();
      }
    } catch (err) {
      console.log('Gemini API call fallback to smart heuristics:', err.message);
    }
  }

  // 2. High-converting smart contextual heuristics fallback
  if (text.includes('hola') || text.includes('buenos') || text.includes('buenas') || text.includes('info') || text.includes('saludos')) {
    return `¡Hola! 👋 Gracias por comunicarte con nuestro equipo. Soy el Asistente Virtual con IA 24/7.\n\n¿En qué podemos ayudarte hoy?\n1️⃣ Consultar planes y servicios de automatización con IA\n2️⃣ Agendar una llamada o demo estratégica\n3️⃣ Solicitar una cotización a medida\n4️⃣ Hablar con un especialista humano`;
  }

  if (text.includes('precio') || text.includes('costo') || text.includes('cuanto') || text.includes('plan') || text.includes('tarifa') || text.includes('1')) {
    return `💵 ¡Excelente! Contamos con planes llave en mano para impulsar tu negocio:\n\n⭐ *Plan Starter:* Agente de WhatsApp 24/7 entrenado a medida.\n🚀 *Plan Growth Pro:* Agente + Agendamiento automático en Google Calendar + Generador de Cotizaciones + CRM.\n\n¿Te gustaría que te preparemos una propuesta personalizada para tu rubro?`;
  }

  if (text.includes('turno') || text.includes('cita') || text.includes('reunion') || text.includes('demo') || text.includes('agendar') || text.includes('2')) {
    return `📅 ¡Con gusto! Para coordinar una demo o sesión estratégica de 15 minutos, indícanos qué día y horario te queda más cómodo (o déjanos tu correo) y nuestro sistema lo reservará en tu calendario.`;
  }

  if (text.includes('cotiza') || text.includes('presupuesto') || text.includes('propuesta') || text.includes('3')) {
    return `📄 ¡Por supuesto! Podemos generarte una cotización oficial con desglose de ítems y link de pago online. ¿Cuál es el nombre de tu empresa y qué solución necesitas implementar?`;
  }

  if (text.includes('humano') || text.includes('asesor') || text.includes('persona') || text.includes('4')) {
    return `👤 Entendido. He notificado a uno de nuestros especialistas del equipo para que revise tu consulta y te responda a la brevedad por este mismo chat. ¡Muchas gracias por tu paciencia!`;
  }

  return `¡Muchas gracias por tu mensaje! 🤖 He recibido tu consulta:\n\n"${userText}"\n\nUn asesor de nuestro equipo se pondrá en contacto contigo a la brevedad. Si deseas conocer nuestros servicios o precios, solo escribe *PRECIOS*.`;
}

// Meta Cloud API Fallback
let META_TOKEN = process.env.META_TOKEN || 'META_TOKEN_PLACEHOLDER';
let META_PHONE_ID = process.env.META_PHONE_ID || '1342311562300304';
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'nexus_ai_secret_token_2026';

function sendMetaWhatsAppMessage(toPhone, messageText) {
  return new Promise((resolve, reject) => {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const postData = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { preview_url: false, body: messageText }
    });

    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v20.0/${META_PHONE_ID}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Meta API Error (${res.statusCode}): ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

// HTTP Server
const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ==================== BAILEYS REAL QR & SESSION ENDPOINTS ====================

  // 1. Start Session
  if (pathname === '/api/wa-session/start' && req.method === 'POST') {
    const sessionId = urlObj.searchParams.get('sessionId') || 'agency_hq';
    getOrInitBaileysSession(sessionId)
      .then(session => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          sessionId,
          status: session.status,
          connected: session.connected,
          phone: session.phone,
          qr: session.qrImage,
          pairingCode: session.pairingCode
        }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  // 2. Request 8-Digit Pairing Code by Phone Number
  if (pathname === '/api/wa-session/pairing-code' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const sessionId = data.sessionId || 'agency_master_1';
        const phone = data.phone;

        if (!phone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Falta ingresar el número de teléfono' }));
          return;
        }

        const clean = phone.replace(/\D/g, '');
        if (clean.length < 8) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Número de teléfono inválido' }));
          return;
        }

        let session = await getOrInitBaileysSession(sessionId);
        let code;
        try {
          if (!session.sock) {
            session = await getOrInitBaileysSession(sessionId, null, true);
            await new Promise(r => setTimeout(r, 1200));
          }
          code = await session.sock.requestPairingCode(clean);
        } catch (sockErr) {
          console.log(`[Baileys - ${sessionId}] Reintentando generación de código con socket limpio...`);
          session = await getOrInitBaileysSession(sessionId, null, true);
          await new Promise(r => setTimeout(r, 1500));
          code = await session.sock.requestPairingCode(clean);
        }

        session.pairingCode = code;
        console.log(`[Baileys - ${sessionId}] 🔢 Código 8-dígitos generado con éxito: ${code}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, code }));
      } catch (err) {
        console.error('Error generando pairing code:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `Error conectando con WhatsApp: ${err.message}` }));
      }
    });
    return;
  }

  // 3. Query Session Status & QR
  if (pathname === '/api/wa-session/status' && req.method === 'GET') {
    const sessionId = urlObj.searchParams.get('sessionId') || 'agency_hq';
    const session = activeSessions[sessionId];

    if (!session) {
      getOrInitBaileysSession(sessionId)
        .then(s => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            connected: s.connected,
            status: s.status,
            phone: s.phone,
            qr: s.qrImage,
            pairingCode: s.pairingCode,
            userName: s.userName
          }));
        })
        .catch(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ connected: false, status: 'uninitialized', phone: null, qr: null }));
        });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: session.connected,
      status: session.status,
      phone: session.phone,
      qr: session.qrImage,
      pairingCode: session.pairingCode,
      userName: session.userName
    }));
    return;
  }

  // 4. Logout Session
  if (pathname === '/api/wa-session/logout' && req.method === 'POST') {
    const sessionId = urlObj.searchParams.get('sessionId') || 'agency_hq';
    const session = activeSessions[sessionId];

    if (session && session.sock) {
      try {
        session.sock.logout();
      } catch (e) {}
    }
    const sessionFolder = path.join(SESSIONS_DIR, sessionId);
    try {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    } catch (e) {}
    delete activeSessions[sessionId];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Dispositivo WhatsApp desvinculado' }));
    return;
  }

  // 5. Send Real WhatsApp message
  if (pathname === '/api/send-whatsapp' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { to, message, token, phoneId, sessionId } = data;
        const activeSessionId = sessionId || 'agency_hq';
        const session = activeSessions[activeSessionId];

        if (session && session.connected && session.sock) {
          const cleanPhone = to.replace(/\D/g, '');
          const jid = `${cleanPhone}@s.whatsapp.net`;
          const result = await session.sock.sendMessage(jid, { text: message });
          console.log(`[Baileys - ${activeSessionId}] 📤 Mensaje real enviado a +${cleanPhone}: "${message.slice(0, 40)}..."`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, engine: 'baileys_socket', result }));
          return;
        }

        if (token) META_TOKEN = token;
        if (phoneId) META_PHONE_ID = phoneId;

        const result = await sendMetaWhatsAppMessage(to, message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, engine: 'meta_cloud_api', result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 6. Meta Webhooks
  if (pathname === '/api/webhook' && req.method === 'GET') {
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
      console.log('✅ Webhook de Meta verificado con éxito');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  if (pathname === '/api/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('📩 Evento de WhatsApp recibido:', body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + err.code);
      }
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Auto-initialize Default Agency Baileys Sessions on Start
getOrInitBaileysSession('agency_master_1')
  .then(() => console.log('🟢 Motor Baileys WhatsApp Multi-Device (agency_master_1) listo para generar códigos QR reales.'))
  .catch(err => console.error('Error iniciando Baileys agency_master_1:', err));

getOrInitBaileysSession('agency_hq')
  .then(() => console.log('🟢 Motor Baileys WhatsApp Multi-Device (agency_hq) listo.'))
  .catch(err => console.error('Error iniciando Baileys agency_hq:', err));

server.listen(PORT, () => {
  console.log(`NEXUS AI Agency Server running at http://localhost:${PORT}/`);
  console.log(`Meta WhatsApp Gateway Ready with Phone ID: ${META_PHONE_ID}`);
});
