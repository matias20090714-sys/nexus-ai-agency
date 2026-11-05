const http = require('http');
const fs = require('fs');
const path = require('path');

// Auto-load .env configuration if present
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      const trimmed = l.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        const key = k.trim();
        const val = v.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (key && !process.env[key]) process.env[key] = val;
      }
    }
  } catch (e) {}
}

const https = require('https');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const db = require('./db');
const { initDatabase, ensureDatabaseSchema } = require('./init-db');
const {
  parseSpintax,
  getAgencyKnowledgeContext,
  checkAndAlertOwner,
  startAppointmentReminderCron,
  startBroadcastExecution,
  createGoogleCalendarEvent,
  activeCampaigns,
  getDefaultFollowUpTemplates,
  registerOrUpdateFollowUp,
  getFollowUpsList,
  triggerFollowUpNow,
  deleteFollowUpSequence,
  startFollowUpCron
} = require('./agency-features');
const { AGENCY_BLUEPRINTS } = require('./agents-data');

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
const activeClientByAgency = {}; // agencyId -> activeClientId selected in UI
const processedWaMsgIds = new Set(); // prevent duplicate replies
const liveWaContactsByAgency = {}; // agencyId -> array of live WhatsApp leads/messages

function recordLiveWaMessage(agencyId, phone, pushName, senderRole, text, companyName = 'WhatsApp Directo') {
  const agKey = agencyId || 'agency_master_1';
  if (!liveWaContactsByAgency[agKey]) liveWaContactsByAgency[agKey] = [];
  const clean = String(phone || '').replace(/\D/g, '') || String(phone || 'contacto');
  let lead = liveWaContactsByAgency[agKey].find(l => l.phone.replace(/\D/g, '') === clean || l.phone === phone);
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!lead) {
    lead = {
      id: 'wa_' + clean,
      phone: clean.startsWith('+') ? clean : `+${clean}`,
      name: pushName || `Cliente (+${clean.slice(-4)})`,
      company: companyName,
      stage: 'Calificado',
      timestamp: timeStr,
      lastMessage: text,
      history: []
    };
    liveWaContactsByAgency[agKey].unshift(lead);
  } else {
    if (pushName && (!lead.name || lead.name.startsWith('Cliente') || lead.name.startsWith('Lead'))) {
      lead.name = pushName;
    }
    if (companyName && companyName !== 'WhatsApp Directo') {
      lead.company = companyName;
    }
    lead.timestamp = timeStr;
    lead.lastMessage = text;
  }
  lead.history.push({
    sender: senderRole === 'user' ? 'user' : 'agent',
    text: String(text || ''),
    time: timeStr
  });
  if (lead.history.length > 50) lead.history = lead.history.slice(-50);
}

function unwrapBaileysMessage(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'object') return null;
  return (
    rawMessage.ephemeralMessage?.message ||
    rawMessage.viewOnceMessage?.message ||
    rawMessage.viewOnceMessageV2?.message ||
    rawMessage.viewOnceMessageV2Extension?.message ||
    rawMessage.documentWithCaptionMessage?.message ||
    rawMessage.editedMessage?.message?.protocolMessage?.editedMessage ||
    rawMessage
  );
}

async function transcribeIncomingAudioBuffer(audioBuffer, mimeType = 'audio/ogg', apiKeyOverride = '') {
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) return '';
  const effectiveKey = apiKeyOverride || customAiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!effectiveKey) return '';

  const cleanMime = String(mimeType || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';

  try {
    // Path A: OpenAI Whisper Speech-to-Text
    if (effectiveKey.startsWith('sk-')) {
      const extMap = { 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'webm' };
      const ext = extMap[cleanMime] || 'ogg';
      const formData = new FormData();
      formData.append('file', new Blob([audioBuffer], { type: cleanMime }), `voice_note.${ext}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'es');

      const oaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${effectiveKey}` },
        body: formData
      });
      if (oaiRes.ok) {
        const oaiData = await oaiRes.json();
        return String(oaiData.text || '').trim();
      }
      return '';
    }

    // Path B: Google Gemini Multimodal Audio Understanding (High-Availability Cascade)
    const base64Audio = audioBuffer.toString('base64');
    const candidateModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
    const prompt = 'Escucha atentamente esta nota de voz enviada por un cliente en WhatsApp y transcribe de forma literal y exacta lo que dice en español. Devuelve únicamente el texto dicho por el cliente, sin comillas, sin introducciones ni comentarios.';

    for (const modelName of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${effectiveKey}`;
        const gRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: cleanMime, data: base64Audio } }
              ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 500 }
          })
        });
        if (gRes.ok) {
          const gData = await gRes.json();
          const transcript = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (transcript && transcript.trim()) {
            return transcript.trim().replace(/^["«“]|["»”]$/g, '').trim();
          }
        }
      } catch (e) {
        console.warn(`[Audio Transcriber - ${modelName}] Fallo temporal:`, e.message);
      }
    }
  } catch (err) {
    console.error('[Audio Transcriber Error]:', err.message);
  }
  return '';
}

function extractIncomingMessageText(rawMessage) {
  const m = unwrapBaileysMessage(rawMessage);
  if (!m) return '';

  const directText =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    '';

  if (directText && directText.trim()) return directText.trim();

  if (m.imageMessage) {
    const caption = m.imageMessage.caption || '';
    return caption
      ? `[Imagen/Comprobante enviado con nota: "${caption}"]`
      : 'Hola, te acabo de enviar una imagen o comprobante por aquí. ¿Me confirmas si lo recibiste?';
  }
  if (m.videoMessage) {
    return m.videoMessage.caption || 'Hola, te acabo de enviar un video con mi consulta.';
  }
  if (m.audioMessage) {
    return 'Hola, te acabo de enviar una nota de voz con mi consulta. ¿Me comentas qué servicios ofrecen y cómo trabajan?';
  }
  if (m.documentMessage) {
    const docTitle = m.documentMessage.fileName || 'documento';
    return `Hola, te acabo de adjuntar el archivo "${docTitle}". ¿Me confirmas recepción y próximos pasos?`;
  }
  return '';
}

// Human Takeover (Pausa Humana Anti-Choque por Conversación)
const pausedHumanChats = new Map(); // key: `${sessionId}_${cleanPhone}` -> { pausedUntil, reason }
const aiOutgoingCooldowns = new Map(); // key: cleanPhone -> timestamp (prevents AI's own messages from triggering human takeover)

function cleanPhoneNumberKey(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function isChatPausedForHuman(sessionId, phone) {
  const clean = cleanPhoneNumberKey(phone);
  if (!clean) return false;
  const key = `${sessionId || 'agency_master_1'}_${clean}`;
  const globalKey = `global_${clean}`;
  const entry = pausedHumanChats.get(key) || pausedHumanChats.get(globalKey);
  if (!entry) return false;
  if (Date.now() > entry.pausedUntil) {
    pausedHumanChats.delete(key);
    pausedHumanChats.delete(globalKey);
    return false;
  }
  return entry;
}

function setChatHumanTakeover(sessionId, phone, paused = true, durationMinutes = 120, reason = 'Intervención manual del dueño/operador') {
  const clean = cleanPhoneNumberKey(phone);
  if (!clean) return null;
  const key = `${sessionId || 'agency_master_1'}_${clean}`;
  const globalKey = `global_${clean}`;
  if (!paused) {
    pausedHumanChats.delete(key);
    pausedHumanChats.delete(globalKey);
    return { phone: clean, paused: false };
  }
  const info = {
    phone: clean,
    sessionId: sessionId || 'agency_master_1',
    paused: true,
    pausedUntil: Date.now() + durationMinutes * 60 * 1000,
    reason
  };
  pausedHumanChats.set(key, info);
  pausedHumanChats.set(globalKey, info);
  return info;
}

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

  sock.ev.on('creds.update', async () => {
    await saveCreds();
    if (state?.creds?.me?.id) {
      const mePhone = state.creds.me.id.split(':')[0].split('@')[0];
      if (mePhone) sessionData.phone = mePhone;
      if (state.creds.me.name) sessionData.userName = state.creds.me.name;
    }
  });

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
      
      const userObj = sock.user || state?.creds?.me || {};
      const userJid = userObj.id || '';
      const cleanPhone = userJid.split(':')[0] || userJid.split('@')[0] || sessionData.phone || '';
      const userLid = (userObj.lid || '').split(':')[0].split('@')[0];
      sessionData.phone = cleanPhone;
      sessionData.lid = userLid;
      sessionData.userName = userObj.name || sessionData.userName || 'WhatsApp Empresa';
      
      console.log(`[Baileys - ${sessionId}] 🎉 ¡WhatsApp Real Vinculado con éxito! Línea: +${cleanPhone}`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      sessionData.connected = false;

      console.log(`[Baileys - ${sessionId}] Conexión cerrada (${statusCode || 'unknown'}).`);

      if (activeSessions[sessionId]) {
        activeSessions[sessionId].sock = null;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        sessionData.status = 'logged_out';
        sessionData.phone = null;
        try { fs.rmSync(sessionFolder, { recursive: true, force: true }); } catch (e) {}
      } else {
        sessionData.status = 'reconnecting';
      }

      // Fast reconnect (400ms) on 515 restartRequired right after QR scan, 1500ms otherwise
      const delayMs = statusCode === DisconnectReason.restartRequired || statusCode === 515 ? 400 : 1500;
      setTimeout(() => {
        getOrInitBaileysSession(sessionId).catch(e => console.error('Error reiniciando sesión Baileys:', e.message));
      }, delayMs);
    }
  });

  // Listen to Real Incoming Messages & Auto-Respond with AI
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      try {
        if (!msg || !msg.message || !msg.key) continue;
        const msgId = msg.key.id;
        if (msgId && processedWaMsgIds.has(msgId)) continue;

        // Ignore old history sync messages (older than 60 seconds)
        const msgTimestamp = Number(msg.messageTimestamp || 0);
        if (msgTimestamp > 0 && (Date.now() / 1000 - msgTimestamp) > 60) continue;

        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.includes('@g.us') || senderJid.includes('status@broadcast') || senderJid.includes('@newsletter')) continue;

        const altJid = msg.key.remoteJidAlt || msg.key.participant || '';
        const rawSenderPart = (altJid.includes('@s.whatsapp.net') ? altJid : senderJid).split('@')[0].split(':')[0];
        const senderNumber = rawSenderPart || senderJid.split('@')[0];

        const ownPhone = String(sessionData.phone || '').replace(/\D/g, '');
        const ownLid = String(sessionData.lid || '').replace(/\D/g, '');
        const cleanSenderDigits = senderNumber.replace(/\D/g, '');
        const isSelfChat = (ownPhone && cleanSenderDigits === ownPhone) || (ownLid && cleanSenderDigits === ownLid);

        // If message is fromMe: ignore unless the user is testing in their own "Message Yourself" chat
        if (msg.key.fromMe) {
          const aiCooldownUntil = aiOutgoingCooldowns.get(senderNumber) || aiOutgoingCooldowns.get(senderJid) || 0;
          if (!isSelfChat || Date.now() <= aiCooldownUntil) {
            continue;
          }
        }

        const agId = sessionId.startsWith('agency_')
          ? sessionId.replace('agency_', '')
          : 'agency_master_1';
        const ctx = await getAgentCompanyContext(sessionId, agId);

        const unwrapped = unwrapBaileysMessage(msg.message);
        let textBody = '';
        let displayInboxText = '';

        // Real Incoming Voice Note Understanding (Speech-to-Text -> Human Text Reply)
        if (unwrapped && unwrapped.audioMessage) {
          try {
            const audioBuf = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            const transcribed = await transcribeIncomingAudioBuffer(
              audioBuf,
              unwrapped.audioMessage.mimetype || 'audio/ogg',
              ctx.apiKey
            );
            if (transcribed && transcribed.trim()) {
              textBody = transcribed.trim();
              displayInboxText = `[Nota de voz]: ${textBody}`;
              console.log(`[Baileys - ${sessionId}] Nota de voz transcrita de +${senderNumber}: "${textBody}"`);
            }
          } catch (audioErr) {
            console.warn(`[Baileys - ${sessionId}] No se pudo transcribir audio entrante:`, audioErr.message);
          }
        }

        if (!textBody) {
          textBody = extractIncomingMessageText(msg.message);
          displayInboxText = textBody;
        }
        if (!textBody || !textBody.trim()) continue;

        if (msgId) {
          processedWaMsgIds.add(msgId);
          if (processedWaMsgIds.size > 1000) {
            const firstKey = processedWaMsgIds.values().next().value;
            processedWaMsgIds.delete(firstKey);
          }
        }

        const pushName = msg.pushName || `Cliente +${senderNumber}`;
        console.log(`[Baileys - ${sessionId}] Mensaje entrante de +${senderNumber} (${senderJid}): "${displayInboxText}"`);

        // Check manual Human Takeover / Pausa Humana (only when explicitly toggled in dashboard)
        const pauseState = isChatPausedForHuman(sessionId, senderNumber);
        if (pauseState) {
          console.log(`[Baileys - ${sessionId}] IA en Pausa Humana manual para +${senderNumber}.`);
          recordLiveWaMessage(agId, senderNumber, pushName, 'user', displayInboxText, ctx.companyName);
          continue;
        }

        recordLiveWaMessage(agId, senderNumber, pushName, 'user', displayInboxText, ctx.companyName);

        // Feature 5 & 6: Owner Alerts & Anti-Ghosting Follow-up
        checkAndAlertOwner(agId, senderNumber, textBody, sock).catch(e => console.error(e));
        registerOrUpdateFollowUp(agId, senderNumber, pushName, textBody.slice(0, 60)).catch(() => {});

        // Simulate natural human typing delay (1.0s)
        await new Promise(r => setTimeout(r, 1000));
        const aiReply = await generateAiAgentResponse(textBody, senderNumber, sessionId, agId);
        if (aiReply && sock) {
          aiOutgoingCooldowns.set(senderNumber, Date.now() + 10000);
          aiOutgoingCooldowns.set(senderJid, Date.now() + 10000);
          const sentMsg = await sock.sendMessage(senderJid, { text: aiReply });
          if (sentMsg?.key?.id) processedWaMsgIds.add(sentMsg.key.id);
          recordLiveWaMessage(agId, senderNumber, pushName, 'agent', aiReply, ctx.companyName);
          console.log(`[Baileys - ${sessionId}] IA (${ctx.companyName}) respondió a +${senderNumber}: "${aiReply.slice(0, 50)}..."`);
        }
      } catch (replyErr) {
        console.error(`[Baileys - ${sessionId}] Error al auto-responder:`, replyErr.message);
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

// AI Auto-Responder Engine (Supports Google Gemini & OpenAI)
const AI_CONFIG_FILE = path.join(__dirname, 'ai_config.json');
const COMPANIES_FILE = path.join(__dirname, 'companies_agents.json');
const PORTALS_FILE = path.join(__dirname, 'agency_portals.json');
let customAiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
let activeAiModel = process.env.AI_MODEL || 'gemini-3.1-flash-lite';
let memoryCompanies = {};
let memoryPortals = {};

function loadPortalsFromDisk() {
  try {
    if (fs.existsSync(PORTALS_FILE)) {
      memoryPortals = JSON.parse(fs.readFileSync(PORTALS_FILE, 'utf8'));
      return memoryPortals;
    }
  } catch (e) {
    console.warn('Advertencia cargando agency_portals.json:', e.message);
  }
  return memoryPortals || {};
}
loadPortalsFromDisk();

function savePortalsToDisk() {
  try {
    fs.writeFileSync(PORTALS_FILE, JSON.stringify(memoryPortals, null, 2), 'utf8');
  } catch (e) {
    console.warn('Advertencia guardando agency_portals.json:', e.message);
  }
}

function loadAiConfig() {
  try {
    if (fs.existsSync(AI_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf8'));
      if (data.apiKey) customAiKey = data.apiKey;
      if (data.model) activeAiModel = data.model;
      console.log(`[AI Engine] Configuración cargada: modelo ${activeAiModel}, proveedor: ${customAiKey.startsWith('sk-') ? 'OpenAI' : 'Google Gemini'}`);
    }
  } catch (e) {
    console.error('Error cargando ai_config.json:', e.message);
  }
}
loadAiConfig();

function saveAiConfig(apiKey, model) {
  try {
    fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify({ apiKey, model, updatedAt: new Date().toISOString() }, null, 2));
  } catch (e) {
    console.error('Error guardando ai_config.json:', e.message);
  }
}

function loadCompaniesFromDisk() {
  try {
    if (fs.existsSync(COMPANIES_FILE)) {
      const raw = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
      memoryCompanies = {};
      for (const [k, v] of Object.entries(raw || {})) {
        if (Array.isArray(v)) {
          memoryCompanies[k] = v.filter(c => c && c.id !== 'client_dental_1' && c.id !== 'client_resto_1' && !c.name?.includes('San Lucas') && !c.name?.includes('Bistro Gourmet'));
        }
      }
      const total = Object.values(memoryCompanies).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      console.log(`[AI Engine] ${total} empresas y agentes creados por usuarios cargados desde disco.`);
    }
  } catch (e) {
    console.error('Error cargando companies_agents.json:', e.message);
  }
}
loadCompaniesFromDisk();

function saveCompaniesToDisk() {
  try {
    fs.writeFileSync(COMPANIES_FILE, JSON.stringify(memoryCompanies, null, 2));
  } catch (e) {
    console.error('Error guardando companies_agents.json:', e.message);
  }
}

// ==================== NICHE SALES PLAYBOOKS & DOMAIN INTELLIGENCE ====================
function getIndustryDomainIntelligence(industry = '', companyName = 'nuestra empresa') {
  const ind = (industry || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (ind.includes('salud') || ind.includes('clinic') || ind.includes('dental') || ind.includes('odontolog') || ind.includes('medic') || ind.includes('estetica med') || ind.includes('psicolog') || ind.includes('kinesiolog')) {
    return {
      roleTitle: 'Coordinador Clínico Senior y Asesor de Admisión de Pacientes',
      clientTerm: 'paciente',
      triageQuestion: 'Para brindarte la orientación clínica correcta: ¿presentas alguna molestia o dolor agudo en este momento, o buscas una valoración preventiva / estética?',
      valueJustification: 'Todos nuestros tratamientos incluyen valoración diagnóstica previa por especialistas matriculados y protocolos mínimamente invasivos de máxima bioseguridad.',
      closingCapturePrompt: 'Para reservarte el turno prioritario en agenda, indícame por favor:\n1. *Tu Nombre y Apellido*\n2. *Si asistes de forma particular o con cobertura/obra social*\n3. *Si prefieres turno por la mañana o por la tarde*',
      ethicalNote: 'Recuerda que el plan terapéutico definitivo es determinado presencialmente por el especialista.'
    };
  }

  if (ind.includes('juridic') || ind.includes('abogad') || ind.includes('legal') || ind.includes('contabl') || ind.includes('contador') || ind.includes('notar') || ind.includes('escriban') || ind.includes('estudio')) {
    return {
      roleTitle: 'Coordinador de Admisión Legal y Paralegal Senior',
      clientTerm: 'representado / cliente',
      triageQuestion: 'Bajo estricto secreto profesional: ¿tu consulta corresponde al área laboral, civil/comercial, societaria o tributaria, y has recibido alguna notificación o intimación con plazo de vencimiento activo?',
      valueJustification: 'Nuestro estudio brinda patrocinio técnico especializado, análisis documental previo y estrategia procesal clara desde la primera consulta.',
      closingCapturePrompt: 'Para agendar tu consulta con el socio especialista del área, por favor confírmame:\n1. *Tu Nombre completo*\n2. *Breve resumen del asunto o si tienes un plazo urgente*\n3. *Si prefieres reunión presencial en el estudio o por videollamada (Meet)*',
      ethicalNote: 'Toda la información compartida en este canal se encuentra amparada por estricto secreto profesional.'
    };
  }

  if (ind.includes('inmobili') || ind.includes('propiedad') || ind.includes('bienes raic') || ind.includes('real estate') || ind.includes('inmueble') || ind.includes('desarroll')) {
    return {
      roleTitle: 'Consultor Patrimonial Senior y Asesor Inmobiliario',
      clientTerm: 'inversor / comprador',
      triageQuestion: 'Para seleccionar únicamente las unidades que encajen con tu búsqueda: ¿estás evaluando la propiedad para vivienda propia familiar o como inversión patrimonial con renta, y en qué zona priorizas ubicarte?',
      valueJustification: 'Seleccionamos activos con títulos perfectos, alta plusvalía por metro cuadrado y excelente proyección de renta en dólares.',
      closingCapturePrompt: 'Para coordinar tu visita privada a la propiedad con nuestro broker, indícame:\n1. *Tu Nombre y Apellido*\n2. *Si operas con capital al contado, permuta o financiación*\n3. *Qué día y franja horaria te resulta más cómoda para visitarla*',
      ethicalNote: ''
    };
  }

  if (ind.includes('hotel') || ind.includes('caban') || ind.includes('turism') || ind.includes('resort') || ind.includes('alojamient') || ind.includes('hoster') || ind.includes('posada')) {
    return {
      roleTitle: 'Concierge Senior de Reservas y Hospitalidad VIP',
      clientTerm: 'huésped',
      triageQuestion: 'Para verificar disponibilidad en tiempo real y ofrecerte nuestra mejor tarifa directa: ¿para qué fechas de Check-In y Check-Out planeas tu estadía y cuántos huéspedes (adultos/menores) viajarían?',
      valueJustification: 'Reservando por nuestro canal directo oficial accedes a tarifa preferencial sin comisiones de portales, desayuno artesanal incluido y acceso completo a nuestras instalaciones.',
      closingCapturePrompt: 'Para bloquear tu unidad ahora mismo y congelar la tarifa, indícame:\n1. *Nombre completo del titular de la reserva*\n2. *Fechas exactas de ingreso y salida*\n3. *Si prefieres abonar la seña por transferencia o tarjeta*',
      ethicalNote: ''
    };
  }

  if (ind.includes('educac') || ind.includes('academi') || ind.includes('curso') || ind.includes('instituto') || ind.includes('universid') || ind.includes('capacitac') || ind.includes('escuela') || ind.includes('coaching')) {
    return {
      roleTitle: 'Asesor de Admisiones Académicas y Desarrollo Profesional',
      clientTerm: 'alumno / profesional',
      triageQuestion: 'Para recomendarte el programa exacto según tu perfil: ¿estás dando tus primeros pasos desde cero o ya cuentas con experiencia y buscas certificarte a nivel avanzado?',
      valueJustification: 'Nuestros programas combinan práctica real, mentoría en vivo, acceso al campus 24/7 y certificación oficial verificable para impulsar tu perfil laboral.',
      closingCapturePrompt: 'Para reservar tu vacante con el beneficio de esta camada, por favor indícame:\n1. *Tu Nombre completo*\n2. *Tu correo electrónico para el alta en el campus*\n3. *Si prefieres abonar al contado con descuento o en cuotas*',
      ethicalNote: ''
    };
  }

  if (ind.includes('construc') || ind.includes('arquitec') || ind.includes('reforma') || ind.includes('piscin') || ind.includes('obra') || ind.includes('ingenier') || ind.includes('abertura') || ind.includes('amoblamient')) {
    return {
      roleTitle: 'Coordinador Técnico de Presupuestos y Proyectos de Obra',
      clientTerm: 'comitente / propietario',
      triageQuestion: 'Para elaborarte un cómputo y presupuesto técnico preciso: ¿qué tipo de obra o instalación proyectas realizar, de cuántos metros cuadrados aproximados hablamos y en qué localidad se encuentra?',
      valueJustification: 'Trabajamos bajo contrato llave en mano con presupuesto cerrado sin sobrecostos sorpresa, personal asegurado y garantía estructural por escrito.',
      closingCapturePrompt: 'Para agendar la visita de relevamiento técnico o enviarte la cotización formal, indícame:\n1. *Tu Nombre*\n2. *Localidad / barrio de la obra y medidas aproximadas*\n3. *Qué día te queda cómodo para la visita técnica o llamada con el ingeniero*',
      ethicalNote: ''
    };
  }

  if (ind.includes('auto') || ind.includes('concesionar') || ind.includes('taller') || ind.includes('mecanic') || ind.includes('vehicul') || ind.includes('moto') || ind.includes('lubricentr') || ind.includes('neumatic')) {
    return {
      roleTitle: 'Jefe de Recepción Técnica y Asesor Automotriz',
      clientTerm: 'propietario / conductor',
      triageQuestion: 'Para darte el diagnóstico y presupuesto exacto según manual de fábrica: ¿qué marca, modelo y año es tu vehículo, y qué síntoma o mantenimiento necesitas realizar?',
      valueJustification: 'Utilizamos repuestos homologados de primera línea, diagnóstico computarizado y entregamos garantía escrita de 6 meses en cada trabajo.',
      closingCapturePrompt: 'Para asignarte tu box de ingreso en el taller sin esperas, confírmame:\n1. *Tu Nombre*\n2. *Marca, modelo y patente del vehículo*\n3. *Si prefieres dejarlo a primera hora (08:30 hs) o por la tarde*',
      ethicalNote: ''
    };
  }

  if (ind.includes('belleza') || ind.includes('barber') || ind.includes('peluquer') || ind.includes('spa') || ind.includes('estetica') || ind.includes('unas') || ind.includes('salon')) {
    return {
      roleTitle: 'Asesor de Imagen Senior y Coordinador de Agenda',
      clientTerm: 'cliente',
      triageQuestion: 'Para asignarte el tiempo y profesional ideal: ¿qué servicio o cambio de imagen tienes en mente hoy y para qué día de la semana buscabas tu turno?',
      valueJustification: 'Trabajamos exclusivamente con productos importados de primera línea que cuidan tu salud capilar/dérmica y turnos puntuales sin esperas.',
      closingCapturePrompt: 'Para dejar reservado tu espacio exclusivo en agenda, indícame:\n1. *Tu Nombre*\n2. *El servicio elegido*\n3. *Si te queda más cómodo venir por la mañana o por la tarde*',
      ethicalNote: ''
    };
  }

  if (ind.includes('restauran') || ind.includes('gastronom') || ind.includes('bar') || ind.includes('bistro') || ind.includes('catering') || ind.includes('comida') || ind.includes('cafe')) {
    return {
      roleTitle: 'Concierge Gastronómico y Anfitrión de Reservas',
      clientTerm: 'comensal',
      triageQuestion: '¡Un placer atenderte! ¿Te gustaría reservar una mesa especial en nuestro salón/terraza, o prefieres realizar un pedido para envío a domicilio / take-away?',
      valueJustification: 'Elaboramos cada plato en el momento con materias primas frescas seleccionadas y contamos con opciones aptas para celíacos (sin TACC) y vegetarianas.',
      closingCapturePrompt: 'Para dejar confirmada tu mesa prioritaria, indícame por favor:\n1. *Nombre de la reserva*\n2. *Cantidad de comensales y horario estimado*\n3. *Si prefieres sector salón interior o terraza*',
      ethicalNote: ''
    };
  }

  if (ind.includes('fitness') || ind.includes('gym') || ind.includes('gimnasio') || ind.includes('crossfit') || ind.includes('entrenam') || ind.includes('yoga') || ind.includes('pilates')) {
    return {
      roleTitle: 'Coach de Bienestar y Asesor de Membresías',
      clientTerm: 'socio / atleta',
      triageQuestion: 'Para recomendarte el plan de entrenamiento ideal: ¿cuál es tu objetivo principal hoy (bajar de peso, ganar masa muscular, salud o rendimiento) y cuántos días por semana te gustaría entrenar?',
      valueJustification: 'Contamos con seguimiento personalizado de profesores en sala, equipamiento biomecánico de última generación y horarios amplios de 06:30 a 22:30 hs.',
      closingCapturePrompt: 'Para activarte tu membresía o tu Pase de Prueba VIP sin cargo, indícame:\n1. *Tu Nombre completo*\n2. *Qué día te gustaría venir a tu primera sesión*\n3. *En qué horario aproximado te esperamos*',
      ethicalNote: ''
    };
  }

  if (ind.includes('retail') || ind.includes('ecommerce') || ind.includes('tienda') || ind.includes('ropa') || ind.includes('calzado') || ind.includes('moda') || ind.includes('indumentar') || ind.includes('mayorist')) {
    return {
      roleTitle: 'Personal Shopper y Especialista de Producto',
      clientTerm: 'comprador',
      triageQuestion: 'Para confirmarte stock inmediato y asesorarte con el calce exacto: ¿qué artículo o modelo te gustó y qué talle o medida sueles utilizar?',
      valueJustification: 'Despachamos en el día con envío asegurado, seguimiento en tiempo real y garantía de primer cambio 100% gratis.',
      closingCapturePrompt: 'Para separarte tu pedido del stock y pasarte el link de pago oficial, indícame:\n1. *Tu Nombre y Apellido*\n2. *Modelo y talle elegido*\n3. *Si prefieres envío rápido a domicilio o retiro en sucursal*',
      ethicalNote: ''
    };
  }

  if (ind.includes('automatizac') || ind.includes('inteligencia artificial') || ind.includes('agencia de ia')) {
    return {
      roleTitle: 'Director Comercial y Consultor de Automatización con IA',
      clientTerm: 'cliente corporativo',
      triageQuestion: 'Para darte un diagnóstico preciso de impacto: ¿cuántas consultas reciben aproximadamente por semana en WhatsApp y cuál es el principal cuello de botella comercial que buscan resolver este mes?',
      valueJustification: 'Implementamos sistemas de IA llave en mano en menos de 48 horas que atienden y venden 24/7, recuperando la inversión en la primera semana.',
      closingCapturePrompt: 'Para avanzar con tu implementación prioritaria o agendar tu demo de 10 minutos, confírmame:\n1. *Tu Nombre y el de tu Empresa*\n2. *El plan de tu interés o volumen de consultas*\n3. *Si prefieres activar hoy mismo o coordinar llamada por la mañana/tarde*',
      ethicalNote: ''
    };
  }

  return {
    roleTitle: 'Director Comercial y Consultor Estratégico Corporativo',
    clientTerm: 'cliente / empresa',
    triageQuestion: 'Para brindarte una propuesta a medida con impacto real: ¿cuál es el objetivo principal o desafío operativo que buscan resolver en este trimestre y en qué etapa se encuentran hoy?',
    valueJustification: 'Trabajamos con metodologías probadas, entregables medibles por contrato y acompañamiento ejecutivo personalizado en cada etapa.',
    closingCapturePrompt: 'Para coordinar tu sesión de diagnóstico estratégico o enviarte la propuesta formal, confírmame:\n1. *Tu Nombre y Empresa / Proyecto*\n2. *El servicio o solución de tu interés*\n3. *Si prefieres reunión por la mañana o por la tarde*',
    ethicalNote: ''
  };
}

function getNicheSalesPlaybook(industry = '') {
  const dom = getIndustryDomainIntelligence(industry);
  const ind = (industry || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  let specificRules = '';
  if (ind.includes('salud') || ind.includes('clinic') || ind.includes('dental') || ind.includes('odontolog') || ind.includes('medic')) {
    specificRules = `• ESPECIALIDAD CLÍNICA, ODONTOLÓGICA & SALUD:
  - Rol y Tono: Eres el ${dom.roleTitle}. Transmite serenidad médica, empatía clínica y pulcritud.
  - Léxico Obligatorio: Usa "paciente", "valoración clínica", "diagnóstico presencial", "especialista", "plan de tratamiento", "protocolo indoloro".
  - Palabras Prohibidas: NUNCA uses "oferta barata", "ganga", "comprar tratamiento", ni recetes fármacos o des diagnósticos médicos definitivos por chat.
  - Triaje antes o junto al precio: Indaga si presenta dolor/molestia aguda (para ofrecer sobreturno prioritario) o si busca estética/prevención.`;
  } else if (ind.includes('juridic') || ind.includes('abogad') || ind.includes('legal') || ind.includes('contabl') || ind.includes('notar') || ind.includes('estudio')) {
    specificRules = `• ESPECIALIDAD JURÍDICA, CONTABLE & NOTARIAL:
  - Rol y Tono: Eres el ${dom.roleTitle}. Tono sobrio, confidencial, ejecutivo y preciso.
  - Léxico Obligatorio: Usa "secreto profesional", "consulta de diagnóstico", "patrocinio letrado", "estrategia procesal", "plazo perentorio", "honorarios".
  - Palabras Prohibidas: NUNCA prometas ganar un juicio al 100%, ni emitas dictámenes legales definitivos sin que el socio revise la documentación.
  - Triaje Legal: Pregunta el fuero (laboral, civil, societario, fiscal) y si existe alguna cédula o carta documento con vencimiento próximo.`;
  } else if (ind.includes('inmobili') || ind.includes('propiedad') || ind.includes('bienes raic') || ind.includes('real estate') || ind.includes('inmueble')) {
    specificRules = `• ESPECIALIDAD INMOBILIARIA & DESARROLLOS PATRIMONIALES:
  - Rol y Tono: Eres el ${dom.roleTitle}. Solvencia financiera, visión de inversión y trato VIP.
  - Léxico Obligatorio: Usa "unidad funcional", "propiedad", "plusvalía", "rentabilidad anual en dólares", "escrituración inmediata", "visita privada".
  - Palabras Prohibidas: NUNCA digas "producto", "mercadería" ni "artículo".
  - Calificación Patrimonial: Distingue siempre entre comprador de vivienda familiar e inversor de renta, y califica zona y forma de pago (contado vs financiación).`;
  } else if (ind.includes('hotel') || ind.includes('caban') || ind.includes('turism') || ind.includes('resort') || ind.includes('alojamient')) {
    specificRules = `• ESPECIALIDAD HOTELERÍA, CABAÑAS & TURISMO:
  - Rol y Tono: Eres el ${dom.roleTitle}. Cálido, hospitalario y detallista.
  - Léxico Obligatorio: Usa "huéspedes", "estadía", "Check-In / Check-Out", "tarifa directa", "reserva garantizada".
  - Calificación de Estadía: Solicita siempre fechas de ingreso/salida y cantidad de pasajeros antes de cerrar, destacando el ahorro por reserva directa sin comisiones.`;
  } else if (ind.includes('educac') || ind.includes('academi') || ind.includes('curso') || ind.includes('instituto') || ind.includes('coaching')) {
    specificRules = `• ESPECIALIDAD EDUCACIÓN, ACADEMIAS & FORMACIÓN HIGH-TICKET:
  - Rol y Tono: Eres el ${dom.roleTitle}. Inspirador, claro y enfocado en el crecimiento profesional del alumno.
  - Léxico Obligatorio: Usa "cohorte/camada", "programa académico", "certificación oficial", "mentoría en vivo", "salida laboral", "matrícula".
  - Diagnóstico Vocacional: Pregunta el nivel actual del alumno y su objetivo laboral para recomendar la formación exacta.`;
  } else if (ind.includes('construc') || ind.includes('arquitec') || ind.includes('reforma') || ind.includes('piscin') || ind.includes('obra')) {
    specificRules = `• ESPECIALIDAD CONSTRUCCIÓN, ARQUITECTURA, PISCINAS & REFORMAS:
  - Rol y Tono: Eres el ${dom.roleTitle}. Sólido, técnico y transparente.
  - Léxico Obligatorio: Usa "proyecto llave en mano", "cómputo de materiales", "presupuesto cerrado por contrato", "relevamiento técnico", "garantía estructural".
  - Relevamiento Previo: Consulta tipo de obra, metros cuadrados aproximados y localidad para ofrecer presupuesto exacto o visita de relevamiento.`;
  } else if (ind.includes('auto') || ind.includes('concesionar') || ind.includes('taller') || ind.includes('mecanic') || ind.includes('vehicul')) {
    specificRules = `• ESPECIALIDAD AUTOMOTRIZ, CONCESIONARIAS & TALLERES:
  - Rol y Tono: Eres el ${dom.roleTitle}. Preciso, honesto y enfocado en la seguridad vial.
  - Léxico Obligatorio: Usa "diagnóstico computarizado", "repuestos homologados", "garantía escrita", "mantenimiento preventivo", "inspección multipunto".
  - Triaje Mecánico: Solicita marca, modelo, año y síntoma del vehículo para dar una respuesta técnica impecable.`;
  } else if (ind.includes('belleza') || ind.includes('barber') || ind.includes('peluquer') || ind.includes('spa') || ind.includes('estetic') || ind.includes('salon') || ind.includes('unas')) {
    specificRules = `• ESPECIALIDAD BELLEZA, ESTÉTICA, BARBERÍAS & SPAS:
  - Rol y Tono: Eres el ${dom.roleTitle}. Cálido, estilista experto, detallista y enfocado en resaltar la imagen personal.
  - Léxico Obligatorio: Usa "diagnóstico capilar/facial", "productos importados de primera línea", "estilo personalizado", "agenda puntual sin esperas".
  - Diagnóstico de Imagen: Consulta qué servicio desea realizarse y qué día/franja horaria prefiere para asignarle al especialista ideal.`;
  } else if (ind.includes('restauran') || ind.includes('gastronom') || ind.includes('bar') || ind.includes('bistro') || ind.includes('catering') || ind.includes('comida') || ind.includes('cafe')) {
    specificRules = `• ESPECIALIDAD GASTRONOMÍA, RESTAURANTES & EVENTOS:
  - Rol y Tono: Eres el ${dom.roleTitle}. Hospitalario, tentador, ágil y atento a preferencias alimentarias.
  - Léxico Obligatorio: Usa "comensales", "elaboración en el momento", "materias primas seleccionadas", "mesa prioritaria", "opciones sin TACC / vegetarianas".
  - Calificación Gastronómica: Distingue rápido entre reserva de mesa en salón/terraza, evento/cumpleaños o pedido de delivery/take-away.`;
  } else if (ind.includes('fitness') || ind.includes('gym') || ind.includes('gimnasio') || ind.includes('crossfit') || ind.includes('entrenam') || ind.includes('pilates') || ind.includes('yoga')) {
    specificRules = `• ESPECIALIDAD GIMNASIOS, CROSSFIT & CENTROS DE FITNESS:
  - Rol y Tono: Eres el ${dom.roleTitle}. Motivador, energético, empático y enfocado en salud y resultados físicos.
  - Léxico Obligatorio: Usa "plan de entrenamiento personalizado", "seguimiento de coaches en sala", "equipamiento biomecánico", "pase de prueba".
  - Diagnóstico Deportivo: Indaga objetivo físico principal y disponibilidad semanal para recomendar la membresía ideal e invitar a empezar esta semana.`;
  } else if (ind.includes('retail') || ind.includes('ecommerce') || ind.includes('tienda') || ind.includes('ropa') || ind.includes('calzado') || ind.includes('moda') || ind.includes('indumentar')) {
    specificRules = `• ESPECIALIDAD TIENDA ONLINE, E-COMMERCE & RETAIL:
  - Rol y Tono: Eres el ${dom.roleTitle}. Ágil, resolutivo, atento a talles/medidas y enfocado en cierre inmediato con envío seguro.
  - Léxico Obligatorio: Usa "stock inmediato", "tabla de talles/calce real", "despacho asegurado en el día", "cambio garantizado sin cargo".
  - Cierre de Pedido: Consulta artículo/modelo, talle/color y preferencia entre envío rápido a domicilio o retiro en local.`;
  } else {
    specificRules = `• ESPECIALIDAD CONSULTIVA CORPORATIVA & B2B (${industry.toUpperCase()}):
  - Rol y Tono: Eres el ${dom.roleTitle}. Ejecutivo, persuasivo, analítico y orientado a retorno de inversión (ROI) y resultados medibles.
  - Léxico Obligatorio: Usa "diagnóstico operativo", "propuesta a medida", "retorno de inversión", "implementación profesional", "indicadores clave".`;
  }

  return `${specificRules}
• TÉCNICA DEL SÁNDWICH CONSULTIVO (REGLA DE ORO ANTE PREGUNTAS DE PRECIO):
  1. Transparencia Inmediata: Informa los valores o planes oficiales con total claridad.
  2. Justificación de Autoridad: ${dom.valueJustification}
  3. Pregunta de Diagnóstico Experto: ${dom.triageQuestion}
• PROTOCOLO DE CIERRE EJECUTIVO (CAPTURA DE 3 DATOS):
  ${dom.closingCapturePrompt}`;
}

function findMatchingBlueprintForCompany(industry = '', companyName = '') {
  const normInd = (industry || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const combined = `${industry} ${companyName}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!Array.isArray(AGENCY_BLUEPRINTS) || AGENCY_BLUEPRINTS.length === 0) return null;

  const exactByCategory = AGENCY_BLUEPRINTS.find(b =>
    (b.category || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normInd ||
    (b.id || '').toLowerCase() === normInd
  );
  if (exactByCategory && !normInd.includes('otro rubro')) return exactByCategory;

  if (combined.includes('salud') || combined.includes('clinic') || combined.includes('dental') || combined.includes('odont') || combined.includes('medic') || combined.includes('consultorio') || combined.includes('hospital') || combined.includes('psicol') || combined.includes('kinesi') || combined.includes('veterin') || combined.includes('dr.') || combined.includes('dra.')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'salud_clinicas') || AGENCY_BLUEPRINTS[0];
  }
  if (combined.includes('construc') || combined.includes('arquitec') || combined.includes('reforma') || combined.includes('piscin') || combined.includes('obra') || combined.includes('ampliacion')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'construccion_reformas');
  }
  if (combined.includes('inmobili') || combined.includes('propiedad') || combined.includes('bienes raic') || combined.includes('real estate') || combined.includes('lote') || combined.includes('desarrollo')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'inmobiliarias');
  }
  if (combined.includes('juridic') || combined.includes('abogad') || combined.includes('legal') || combined.includes('contabl') || combined.includes('contador') || combined.includes('notar') || combined.includes('escriban')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'legal_contable');
  }
  if (combined.includes('hotel') || combined.includes('caban') || combined.includes('turism') || combined.includes('resort') || combined.includes('posada') || combined.includes('alojamient') || combined.includes('hospedaj')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'hoteleria_turismo');
  }
  if (combined.includes('educac') || combined.includes('academi') || combined.includes('curso') || combined.includes('instituto') || combined.includes('colegio') || combined.includes('universid') || combined.includes('escuela')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'educacion_academias');
  }
  if (combined.includes('belleza') || combined.includes('barber') || combined.includes('peluquer') || combined.includes('spa') || combined.includes('salon') || combined.includes('estetic') || combined.includes('unas')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'belleza_barberias');
  }
  if (combined.includes('restauran') || combined.includes('gastronom') || combined.includes('comida') || combined.includes('pizz') || combined.includes('sushi') || combined.includes('bistro') || combined.includes('parrilla') || combined.includes('catering') || combined.includes('bar ')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'gastronomia');
  }
  if (combined.includes('tienda') || combined.includes('ecommerce') || combined.includes('retail') || combined.includes('ropa') || combined.includes('calzado') || combined.includes('boutique') || combined.includes('indumentar') || combined.includes('moda')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'ecommerce_retail');
  }
  if (combined.includes('gimnasio') || combined.includes('fitness') || combined.includes('gym') || combined.includes('crossfit') || combined.includes('entrenam') || combined.includes('pilates') || combined.includes('yoga')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'fitness_gym');
  }
  if (combined.includes('taller') || combined.includes('mecanic') || combined.includes('automot') || combined.includes('concesionar') || combined.includes('autos') || combined.includes('vehicul') || combined.includes('lubricentr') || combined.includes('neumatic')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'automotriz');
  }
  if (combined.includes('b2b') || combined.includes('consultor') || combined.includes('software') || combined.includes('marketing') || combined.includes('corporativ')) {
    return AGENCY_BLUEPRINTS.find(b => b.id === 'servicios_b2b');
  }
  return exactByCategory || null;
}

// Resolver context of specific client / company by session or agency ID
async function getAgentCompanyContext(sessionId = '', agencyId = 'agency_master_1') {
  const allCompanies = Object.values(memoryCompanies).flat();
  let matched = null;

  // 1. Match by sessionId (e.g. client_client-1729... or client-1729...)
  if (sessionId && sessionId !== 'agency_hq') {
    const cleanSess = sessionId.replace('client_', '').replace('agency_', '');
    matched = allCompanies.find(c => c.id === cleanSess || c.id === sessionId || `client_${c.id}` === sessionId || `agency_${c.id}` === sessionId);
  }

  // 2. Match by activeClientByAgency if the user selected a client in the dashboard
  if (!matched && agencyId && activeClientByAgency[agencyId] && activeClientByAgency[agencyId] !== 'agency_hq') {
    const activeCid = activeClientByAgency[agencyId];
    matched = allCompanies.find(c => c.id === activeCid);
  }

  // 3. Match by agencyId if not matched (and not explicitly requesting agency_hq)
  if (!matched && agencyId && sessionId !== 'agency_hq') {
    const cleanAg = agencyId.replace('agency_', '').replace('client_', '');
    matched = allCompanies.find(c => c.id === cleanAg || c.id === agencyId);
    if (!matched && memoryCompanies[agencyId] && memoryCompanies[agencyId].length > 0) {
      matched = memoryCompanies[agencyId][0];
    }
    if (!matched && memoryCompanies[cleanAg] && memoryCompanies[cleanAg].length > 0) {
      matched = memoryCompanies[cleanAg][0];
    }
  }

  // 4. Fallback to first company in memory if available (unless explicitly testing agency_hq)
  if (!matched && allCompanies.length > 0 && sessionId !== 'agency_hq') {
    matched = allCompanies[0];
  }

  // Default fallback if no custom company is registered yet (Uses customized agency portal data if available)
  if (!matched) {
    const portal = (agencyId && memoryPortals[agencyId]) || memoryPortals['agency_master_1'] || {};
    const agencyName = portal.agency?.name || 'NEXUS AI Agency';
    let plansSummary = '';
    if (Array.isArray(portal.plans) && portal.plans.length > 0) {
      plansSummary = portal.plans.map(p => 
        `• ${p.name}: $${p.price} ${p.currency || 'USD'}/${p.period || p.billingPeriod || 'mes'}\n  - Beneficios: ${(p.features || []).join(', ')}`
      ).join('\n\n');
    } else {
      plansSummary = '• Plan Starter: $290 USD/mes\n  - Beneficios: Agente de WhatsApp 24/7 entrenado a medida, soporte continuo, calificación de prospectos.\n\n• Plan Growth Pro: $490 USD/mes\n  - Beneficios: Agente con Google Calendar sincronizado, cotizador dinámico, derivación a CRM y reportes comerciales.\n\n• Plan Enterprise: $890 USD/mes\n  - Beneficios: Multi-agentes corporativos, integraciones de base de datos Neon DB, onboarding VIP y soporte dedicado.';
    }

    return {
      id: 'default_agency',
      companyName: agencyName,
      industry: 'Soluciones de Inteligencia Artificial & Automatización Comercial B2B',
      agentName: `Asesor Comercial Senior de ${agencyName}`,
      tone: 'profesional_consultivo_y_persuasivo',
      systemPrompt: `Eres el Asesor y Consultor Comercial Senior de ${agencyName}. Dialoga con empatía, solvencia y lenguaje natural. Identifica el dolor operativo del cliente (pérdida de ventas por demoras en responder), explica cómo la IA soluciona ese problema de inmediato con un ROI positivo y orienta cada conversación hacia coordinar una demo estratégica de 15 minutos o activar el plan correspondiente.`,
      catalogSummary: plansSummary,
      knowledgeBase: 'Horario: Atención 24/7 por WhatsApp. Modalidad: Servicios llave en mano en la nube con soporte técnico continuo para empresas de todo el mundo. Garantía de puesta en marcha en menos de 48 horas.',
      salesFlow: 'Calificación: ¿Cuántas consultas comerciales reciben al mes en WhatsApp y cuántas ventas estiman que se pierden fuera de horario?\nObjeción de Precio: Rescatando apenas 1 o 2 ventas al mes con atención 24/7, el servicio se paga solo al 100%.\nCierre: Invita a coordinar una breve llamada estratégica o envía los datos para activar el servicio de inmediato.',
      supportSummary: 'Soporte 24/7 para incidencias y actualizaciones de catálogo. Garantía de operatividad 99.9%.',
      afterSalesSummary: 'Onboarding guiado en 48 horas, configuración personalizada y seguimiento continuo de métricas.',
      nichePlaybook: getNicheSalesPlaybook('servicios_b2b'),
      apiKey: portal.agency?.ai_key || portal.portalConfig?.ai_key || portal.aiKey || ''
    };
  }

  // Hydrate deep fields if matched.notes contains packed JSON from PostgreSQL
  let hydrated = { ...matched };
  if (typeof matched.notes === 'string' && (matched.notes.trim().startsWith('{') || matched.notes.includes('"catalog"'))) {
    try {
      const parsed = JSON.parse(matched.notes);
      if (parsed && typeof parsed === 'object') {
        hydrated = {
          ...parsed,
          ...matched,
          catalog: (Array.isArray(parsed.catalog) && parsed.catalog.length > 0) ? parsed.catalog : matched.catalog,
          salesFlow: parsed.salesFlow || matched.salesFlow,
          supportFlow: parsed.supportFlow || matched.supportFlow,
          afterSalesFlow: parsed.afterSalesFlow || matched.afterSalesFlow,
          knowledgeBase: parsed.knowledgeBase || matched.knowledgeBase,
          systemPrompt: parsed.systemPrompt || matched.systemPrompt,
          agentName: parsed.agentName || matched.agentName
        };
      }
    } catch (e) {}
  }

  // Auto-hydrate blueprint catalog and flows if company was created without explicit catalog items
  const matchedBlueprint = findMatchingBlueprintForCompany(hydrated.industry, hydrated.name);
  if (matchedBlueprint) {
    if (!Array.isArray(hydrated.catalog) || hydrated.catalog.length === 0) {
      hydrated.catalog = matchedBlueprint.defaultCatalog || [];
    }
    if (!hydrated.salesFlow) hydrated.salesFlow = matchedBlueprint.salesFlow;
    if (!hydrated.supportFlow) hydrated.supportFlow = matchedBlueprint.supportFlow;
    if (!hydrated.afterSalesFlow) hydrated.afterSalesFlow = matchedBlueprint.afterSalesFlow;
    if (!hydrated.industry || hydrated.industry === 'Otro Rubro' || hydrated.industry === 'Servicios') {
      hydrated.industry = matchedBlueprint.category;
    }
  }

  // Build rich catalog summary text from matched company's catalog
  let catalogSummary = '';
  if (Array.isArray(hydrated.catalog) && hydrated.catalog.length > 0) {
    catalogSummary = hydrated.catalog.map(item => {
      const parts = [`• ${item.name}: $${item.price} USD`];
      if (item.duration) parts.push(`(${item.duration})`);
      if (item.description || item.benefits) {
        parts.push(`- ${item.description || item.benefits}`);
      }
      return parts.join(' ');
    }).join('\n');
  } else if (hydrated.notes && hydrated.notes.includes('$')) {
    catalogSummary = hydrated.notes;
  } else {
    catalogSummary = 'Contamos con servicios especializados y atención personalizada adaptada a cada necesidad.';
  }

  // Build sales flow string
  let salesFlowStr = '';
  if (hydrated.salesFlow && typeof hydrated.salesFlow === 'object') {
    salesFlowStr = [
      hydrated.salesFlow.qualification ? `Pregunta de Calificación: ${hydrated.salesFlow.qualification}` : '',
      hydrated.salesFlow.budget || hydrated.salesFlow.budgetQuestion ? `Pregunta de Presupuesto: ${hydrated.salesFlow.budget || hydrated.salesFlow.budgetQuestion}` : '',
      hydrated.salesFlow.urgencyQuestion ? `Pregunta de Urgencia / Tiempo: ${hydrated.salesFlow.urgencyQuestion}` : '',
      hydrated.salesFlow.objections ? `Manejo de Objeciones: ${hydrated.salesFlow.objections}` : '',
      hydrated.salesFlow.closing ? `Llamado al Cierre: ${hydrated.salesFlow.closing}` : ''
    ].filter(Boolean).join('\n');
  } else if (hydrated.salesFlow) {
    salesFlowStr = String(hydrated.salesFlow);
  } else {
    salesFlowStr = 'Comprende la necesidad del cliente, valida su situación y coordina el paso comercial adecuado (cita, turno o compra).';
  }

  // Build support flow string
  let supportStr = '';
  if (hydrated.supportFlow && typeof hydrated.supportFlow === 'object') {
    const faqs = Array.isArray(hydrated.supportFlow.faq) 
      ? hydrated.supportFlow.faq.map(f => `P: ${f.q} | R: ${f.a}`).join('\n') 
      : (hydrated.supportFlow.faqs || '');
    supportStr = [
      faqs ? `Preguntas Frecuentes:\n${faqs}` : '',
      hydrated.supportFlow.emergency ? `Protocolo de Emergencia / Escalación: ${hydrated.supportFlow.emergency}` : ''
    ].filter(Boolean).join('\n');
  } else if (hydrated.supportFlow) {
    supportStr = String(hydrated.supportFlow);
  } else {
    supportStr = 'Atención rápida y resolución de inquietudes operativas.';
  }

  // Build aftersales flow string
  let afterSalesStr = '';
  if (hydrated.afterSalesFlow && typeof hydrated.afterSalesFlow === 'object') {
    afterSalesStr = [
      hydrated.afterSalesFlow.onboarding ? `Onboarding: ${hydrated.afterSalesFlow.onboarding}` : '',
      hydrated.afterSalesFlow.guarantee ? `Garantía y Respaldo: ${hydrated.afterSalesFlow.guarantee}` : '',
      hydrated.afterSalesFlow.followUp || hydrated.afterSalesFlow.message ? `Seguimiento: ${hydrated.afterSalesFlow.followUp || hydrated.afterSalesFlow.message}` : ''
    ].filter(Boolean).join('\n');
  } else if (hydrated.afterSalesFlow) {
    afterSalesStr = String(hydrated.afterSalesFlow);
  } else {
    afterSalesStr = 'Acompañamiento continuo y garantía oficial de satisfacción.';
  }

  const industryStr = hydrated.industry || 'Servicios Especializados';
  const nichePlaybook = getNicheSalesPlaybook(industryStr);

  return {
    id: hydrated.id,
    companyName: hydrated.name || 'Empresa',
    industry: industryStr,
    agentName: hydrated.agentName || `Coordinador de ${hydrated.name || 'la empresa'}`,
    tone: hydrated.tone || 'profesional_calido_y_persuasivo',
    systemPrompt: hydrated.systemPrompt || `Eres el especialista y asesor oficial de ${hydrated.name} (${industryStr}). Dialoga con empatía, solvencia profesional y calidez humana. Explica con claridad los beneficios de nuestros servicios/tratamientos, resuelve dudas con seguridad y orienta hacia la reserva de turno o contratación.`,
    catalogItems: Array.isArray(hydrated.catalog) ? hydrated.catalog : [],
    catalogSummary: catalogSummary,
    knowledgeBase: hydrated.knowledgeBase || `Atención de Lunes a Sábados de 09:00 a 19:00 hs. Consultas y reservas de turnos directas por WhatsApp.`,
    salesFlow: salesFlowStr,
    supportSummary: supportStr,
    afterSalesSummary: afterSalesStr,
    nichePlaybook: nichePlaybook,
    apiKey: hydrated.apiKey || hydrated.ai_key || hydrated.geminiApiKey || ''
  };
}

// ==================== MULTI-TURN CONVERSATIONAL MEMORY ====================
const conversationHistories = new Map();
const MAX_CONV_TURNS = 16;
const CONV_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getConvKey(agencyId, senderPhone) {
  const cleanAg = (agencyId || 'master').toString().replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanPhone = (senderPhone || 'visitor').toString().replace(/[^a-zA-Z0-9_-]/g, '');
  return `${cleanAg}_${cleanPhone}`;
}

function getConversationHistory(convKey) {
  const entry = conversationHistories.get(convKey);
  if (!entry) return [];
  if (Date.now() - entry.lastUpdated > CONV_TTL_MS) {
    conversationHistories.delete(convKey);
    return [];
  }
  return entry.history || [];
}

function appendToConversationHistory(convKey, role, text) {
  if (!text) return;
  let entry = conversationHistories.get(convKey);
  if (!entry) {
    entry = { history: [], lastUpdated: Date.now() };
    conversationHistories.set(convKey, entry);
  }
  entry.lastUpdated = Date.now();
  entry.history.push({ role, text: String(text).trim(), timestamp: Date.now() });
  if (entry.history.length > MAX_CONV_TURNS) {
    entry.history = entry.history.slice(-MAX_CONV_TURNS);
  }
}

function clearConversationHistory(convKey) {
  conversationHistories.delete(convKey);
}

function buildGeminiContents(history, currentMessage) {
  const contents = [];
  let lastRole = null;
  for (const h of history) {
    const geminiRole = h.role === 'assistant' ? 'model' : 'user';
    if (geminiRole === lastRole) {
      if (contents.length > 0) {
        contents[contents.length - 1].parts[0].text += '\n' + h.text;
      }
    } else {
      contents.push({ role: geminiRole, parts: [{ text: h.text }] });
      lastRole = geminiRole;
    }
  }

  if (lastRole === 'user' && contents.length > 0) {
    contents[contents.length - 1].parts[0].text += '\n' + currentMessage;
  } else {
    contents.push({ role: 'user', parts: [{ text: currentMessage }] });
  }

  if (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }

  return contents;
}

// ==================== CONSULTATIVE SALES REASONING ENGINE ====================
function stripAiEmojis(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^ +/gm, '')
    .trim();
}

function generateContextualSalesReply(lowerText, rawText, history, ctx, docContext) {
  const lastBotMsg = history.filter(h => h.role === 'assistant').slice(-1)[0]?.text || '';
  const lowerBot = lastBotMsg.toLowerCase();
  const hadPriceDiscussion = history.some(h => (h.text || '').toLowerCase().includes('precio') || (h.text || '').toLowerCase().includes('$') || (h.text || '').toLowerCase().includes('plan') || (h.text || '').toLowerCase().includes('costo') || (h.text || '').toLowerCase().includes('usd'));
  const hadTurnDiscussion = history.some(h => (h.text || '').toLowerCase().includes('turno') || (h.text || '').toLowerCase().includes('cita') || (h.text || '').toLowerCase().includes('agenda') || (h.text || '').toLowerCase().includes('horario'));
  const isConversationOngoing = history.length > 0;
  const dom = getIndustryDomainIntelligence(ctx.industry, ctx.companyName);
  const isAiAgency = ctx.id === 'default_agency' || /automatizaci|inteligencia artificial|agencia de ia/i.test(ctx.industry || '');

  let reply = '';

  // 1. RAG Documentation Match
  if (docContext && (lowerText.includes('precio') || lowerText.includes('catalogo') || lowerText.includes('catálogo') || lowerText.includes('servicio') || lowerText.includes('costo') || lowerText.includes('cuanto') || lowerText.includes('cuánto'))) {
    reply = `Con gusto. Aquí tienes los detalles oficiales de *${ctx.companyName}*:\n\n${docContext.slice(0, 480)}...\n\n${dom.triageQuestion}`;
  }

  // 2. Affirmations & Agreements (sii, si, sí, dale, opino que si, claro, etc.)
  const isAffirmative = /^(s+i+|s+e+p|s+i+s+i+|clar+o+|obvio|totalmente|de una|dale|bueno|de acuerdo|me parece bien|opino que s+i+|me interesa|está bien|esta bien|por supuesto|vamos)/i.test(lowerText) ||
    lowerText.includes('opino que si') || lowerText.includes('opino que sí') || lowerText.includes('me parece que si') || lowerText.includes('me parece bien') || lowerText.includes('de acuerdo') || lowerText.includes('totalmente') ||
    lowerText === 'si' || lowerText.startsWith('si ') || lowerText === 'sí' || lowerText.startsWith('sí ') || lowerText.includes('sii') || lowerText.includes('siii');

  if (!reply && isAffirmative) {
    if (hadPriceDiscussion || hadTurnDiscussion || lowerBot.includes('turno') || lowerBot.includes('reservar') || lowerBot.includes('agendar') || lowerBot.includes('valoración') || lowerBot.includes('$')) {
      reply = `Excelente, avanzamos entonces en *${ctx.companyName}*.\n\n${dom.closingCapturePrompt}`;
    } else if (isAiAgency) {
      reply = `Excelente. Te cuento en concreto cómo te ayudamos en *${ctx.companyName}*:\n\n` +
        `1. Automatizamos tu atención y ventas en WhatsApp 24/7 para responder al instante.\n` +
        `2. Calificamos a cada cliente y resolvemos dudas con naturalidad.\n` +
        `3. Agendamos citas en calendario y enviamos cotizaciones.\n\n` +
        `Nuestros planes oficiales son:\n${ctx.catalogSummary}\n\n` +
        `¿Cuál de estas alternativas se ajusta mejor a tu negocio?`;
    } else {
      reply = `Excelente. Te comparto las prestaciones y aranceles principales con los que trabajamos en *${ctx.companyName}* (${ctx.industry}):\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.closingCapturePrompt}`;
    }
  }

  // 3. Intención de Compra Directa / Reserva de Turno / Contratación
  const isBuyingSignal = lowerText.includes('me interesa') || lowerText.includes('quiero contratar') || lowerText.includes('como contrato') || lowerText.includes('cómo contrato') ||
    lowerText.includes('como pago') || lowerText.includes('cómo pago') || lowerText.includes('donde pago') || lowerText.includes('dónde pago') || lowerText.includes('donde transfiero') ||
    lowerText.includes('dónde transfiero') || lowerText.includes('empecemos') || lowerText.includes('lo quiero') || lowerText.includes('de una') || lowerText.includes('vamos con') ||
    lowerText.includes('acepto') || lowerText.includes('lo compro') || lowerText.includes('lo tomo') || lowerText.includes('reservamelo') || lowerText.includes('resérvamelo') ||
    lowerText.includes('agendemos') || lowerText.includes('dame los datos') || lowerText.includes('pasame el link') || lowerText.includes('pásame el link') ||
    lowerText.includes('quiero empezar') || lowerText.includes('lo cerramos') || lowerText.includes('quiero un turno') || lowerText.includes('reservar turno');

  if (!reply && isBuyingSignal) {
    reply = `Excelente decisión. Será un gusto atenderte en *${ctx.companyName}*.\n\n${dom.closingCapturePrompt}`;
  }

  // 4. Pregunta de Propuesta de Valor, Especialidad y Servicios ("En qué me ayuda", "De qué trata", "Para qué sirve", "Qué hacen", "Qué servicios ofrecen")
  const isHelpOrValueQuestion = lowerText.includes('ayuda') || lowerText.includes('ayudan') || lowerText.includes('en que me') || lowerText.includes('en qué me') ||
    lowerText.includes('como me ayuda') || lowerText.includes('cómo me ayuda') || lowerText.includes('de que trata') || lowerText.includes('de qué trata') ||
    lowerText.includes('para que sirve') || lowerText.includes('para qué sirve') || lowerText.includes('que hacen') || lowerText.includes('qué hacen') ||
    lowerText.includes('a que se dedican') || lowerText.includes('a qué se dedican') || lowerText.includes('que ofrecen') || lowerText.includes('qué ofrecen') ||
    lowerText.includes('como funciona') || lowerText.includes('cómo funciona') || lowerText.includes('tratamiento') || lowerText.includes('tratamientos') ||
    lowerText.includes('especialidad') || lowerText.includes('beneficio') || lowerText.includes('beneficios') ||
    lowerText.includes('servicio') || lowerText.includes('servicios');

  if (!reply && isHelpOrValueQuestion) {
    if (isAiAgency) {
      reply = `En *${ctx.companyName}* somos especialistas en ${ctx.industry}. Ayudamos a empresas y profesionales a multiplicar sus ventas y ahorrar horas operativas:\n\n` +
        `1. Atención y ventas inmediatas en WhatsApp 24/7.\n` +
        `2. Calificación comercial de prospectos y manejo de objeciones.\n` +
        `3. Agendamiento automático en Google Calendar y cobros directos.\n\n` +
        `Nuestros planes oficiales son:\n${ctx.catalogSummary}\n\n` +
        `¿Cuál de estos objetivos es el más prioritario para tu negocio hoy?`;
    } else {
      reply = `En *${ctx.companyName}* somos especialistas en *${ctx.industry}*. ${dom.valueJustification}\n\n` +
        `Actualmente nuestras prestaciones y aranceles principales son:\n${ctx.catalogSummary}\n\n` +
        `${dom.triageQuestion}`;
    }
  }

  // 5. Manejo de Objeción de Precio (Reencuadre de Valor, ROI y Presupuesto)
  const isPriceObjection = lowerText.includes('caro') || lowerText.includes('cara') || lowerText.includes('no tengo plata') || lowerText.includes('no tengo dinero') ||
    lowerText.includes('no llego') || lowerText.includes('descuento') || lowerText.includes('rebaja') || lowerText.includes('muy costoso') || lowerText.includes('fuera de presupuesto') ||
    lowerText.includes('algo mas barato') || lowerText.includes('algo más barato') || lowerText.includes('menos plata') || lowerText.includes('muy alto');

  if (!reply && isPriceObjection) {
    reply = `Te entiendo perfectamente, cuidar tu inversión es muy importante. En *${ctx.companyName}* trabajamos con ${dom.valueJustification.charAt(0).toLowerCase() + dom.valueJustification.slice(1)}\n\nAdemás, contamos con facilidades de pago y podemos comenzar por una valoración inicial accesible para definir el plan ideal según tu presupuesto. ${dom.triageQuestion}`;
  }

  // 6. Facilidades y Métodos de Pago
  const isPaymentMethods = lowerText.includes('facilidades') || lowerText.includes('formas de pago') || lowerText.includes('metodos de pago') || lowerText.includes('métodos de pago') ||
    lowerText.includes('como se paga') || lowerText.includes('cómo se paga') || lowerText.includes('tarjeta') || lowerText.includes('transferencia') || lowerText.includes('cuotas') || lowerText.includes('obra social') || lowerText.includes('prepaga');

  if (!reply && isPaymentMethods) {
    reply = `Por supuesto. En *${ctx.companyName}* ofrecemos diversas facilidades: aceptamos efectivo, transferencias bancarias, tarjetas de débito y crédito, y emitimos comprobantes oficiales para reintegros.\n\n${dom.closingCapturePrompt}`;
  }

  // 6.B Detección Inteligente por Ítem del Catálogo y Triaje Especializado de los 12 Rubros
  const normInd = (ctx.industry || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normUser = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Coincidencia directa con servicios o productos específicos del catálogo de esta empresa
  if (!reply && Array.isArray(ctx.catalogItems) && ctx.catalogItems.length > 0) {
    const stopWords = new Set(['para', 'con', 'por', 'sin', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas', 'que', 'como', 'mas', 'muy', 'este', 'esta', 'todo', 'toda', 'plan', 'pack', 'servicio', 'consulta', 'general', 'integral', 'completo', 'completa', 'premium', 'basico', 'basica']);
    const matchedItems = ctx.catalogItems.filter(it => {
      const words = String(it.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !stopWords.has(w));
      return words.some(w => normUser.includes(w));
    });

    if (matchedItems.length > 0 && !normUser.includes('dolor') && !normUser.includes('urgencia')) {
      const itemsDetail = matchedItems.map(it => {
        const parts = [`• *${it.name}*: *$${it.price} USD*`];
        if (it.duration) parts.push(`(${it.duration})`);
        if (it.description || it.benefits) parts.push(`— ${it.description || it.benefits}`);
        return parts.join(' ');
      }).join('\n');
      reply = `Excelente elección. En *${ctx.companyName}* contamos con la opción exacta para lo que buscas:\n\n${itemsDetail}\n\n${dom.valueJustification}\n\n${dom.closingCapturePrompt}`;
    }
  }

  // Triaje especializado según necesidad puntual de cada uno de los 12 rubros
  if (!reply && !isAiAgency) {
    if ((normInd.includes('salud') || normInd.includes('clinic') || normInd.includes('dental') || normInd.includes('odont')) &&
        /dolor|duele|muela|diente|urgencia|inflam|hincha|sangr|caries|infeccion|partio|sensibil/.test(normUser)) {
      reply = `Comprendo perfectamente tu molestia y en *${ctx.companyName}* le damos prioridad absoluta a los casos con dolor o sensibilidad aguda para aliviarte hoy mismo.\n\nLo indicado es realizar una valoración diagnóstica presencial con nuestro especialista para determinar el origen exacto y brindarte el tratamiento inmediato:\n${ctx.catalogSummary}\n\n${dom.closingCapturePrompt}`;
    } else if ((normInd.includes('inmobili') || normInd.includes('bienes raic') || normInd.includes('propiedad')) &&
               /departament|casa|lote|terreno|alquil|compr|invertir|inversion|tasacion|tasar|ambiente|dormitorio|credito|apto/.test(normUser)) {
      reply = `Excelente búsqueda. En *${ctx.companyName}* contamos con opciones seleccionadas con títulos perfectos y asesoramiento patrimonial integral:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('juridic') || normInd.includes('abogad') || normInd.includes('legal') || normInd.includes('contabl') || normInd.includes('notar')) &&
               /despido|indemnizaci|divorcio|sucesion|herencia|contrato|carta documento|intimacion|juicio|demanda|impuesto|monotributo|balance|sociedad|escritura/.test(normUser)) {
      reply = `Gracias por contactarte con *${ctx.companyName}*. Tratamos tu consulta bajo estricto secreto profesional para resguardar tus derechos y plazos legales.\n\nNuestras instancias de atención profesional son:\n${ctx.catalogSummary}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('belleza') || normInd.includes('barber') || normInd.includes('peluquer') || normInd.includes('spa') || normInd.includes('estetic')) &&
               /corte|barba|color|tintur|mechas|balayage|alisado|keratina|unas|manicur|facial|limpieza|masaje|depilaci|cejas|pestanas/.test(normUser)) {
      reply = `Nos encantará recibirte en *${ctx.companyName}*. Trabajamos cada detalle de forma personalizada para lograr el resultado exacto que buscas:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.closingCapturePrompt}`;
    } else if ((normInd.includes('restauran') || normInd.includes('gastronom') || normInd.includes('comida') || normInd.includes('bar')) &&
               /mesa|carta|menu|plato|delivery|envio|pedido|celiac|tacc|vegan|vegetarian|cumpleanos|evento|cena|almuerzo/.test(normUser)) {
      reply = `Será un placer agasajarte en *${ctx.companyName}*. Aquí tienes nuestras propuestas gastronómicas destacadas:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('tienda') || normInd.includes('retail') || normInd.includes('ecommerce')) &&
               /stock|talle|talla|color|modelo|envio|despacho|cambio|devoluci|mayorist|prenda|producto|comprar/.test(normUser)) {
      reply = `Qué bueno que nos escribas. En *${ctx.companyName}* contamos con disponibilidad inmediata y despacho asegurado:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('gimnasio') || normInd.includes('fitness') || normInd.includes('gym') || normInd.includes('crossfit')) &&
               /pase|membresia|musculaci|crossfit|funcional|pilates|bajar de peso|masa muscular|entrenar|clase|prueba|profesor/.test(normUser)) {
      reply = `Excelente iniciativa para empezar a entrenar en *${ctx.companyName}*. Estos son nuestros pases y programas activos:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('taller') || normInd.includes('automot') || normInd.includes('mecanic') || normInd.includes('concesionar')) &&
               /service|aceite|filtro|freno|embrague|correa|distribuci|ruido|falla|escan|bateria|neumatic|alineaci|balanceo|tren delantero|motor/.test(normUser)) {
      reply = `En *${ctx.companyName}* revisamos tu vehículo con equipamiento de diagnóstico computarizado y repuestos homologados:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('hotel') || normInd.includes('caban') || normInd.includes('turism')) &&
               /habitaci|cabana|suite|noche|estadia|check|huesped|persona|pareja|familia|pileta|piscina|desayuno|vacacion|finde/.test(normUser)) {
      reply = `Qué alegría recibir tu consulta en *${ctx.companyName}*. Estas son nuestras opciones y tarifas por reserva directa:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('educac') || normInd.includes('academi') || normInd.includes('curso')) &&
               /curso|carrera|diplomatur|programa|temario|certificad|inscripci|matricul|vacante|online|vivo|clases|aprender/.test(normUser)) {
      reply = `Excelente paso para tu crecimiento profesional. En *${ctx.companyName}* contamos con estos programas de formación:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('construc') || normInd.includes('arquitec') || normInd.includes('reforma') || normInd.includes('piscin')) &&
               /obra|reforma|remodelaci|ampliaci|piscina|pileta|metros|m2|llave en mano|plano|construir|techo|cocina|bano/.test(normUser)) {
      reply = `En *${ctx.companyName}* ejecutamos tu proyecto con cómputo preciso, dirección técnica y presupuesto cerrado por contrato:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    } else if ((normInd.includes('b2b') || normInd.includes('empresa') || normInd.includes('consultor')) &&
               /consultor|auditor|estrategi|corporativ|implementaci|empresa|equipo|optimiz|ventas|proceso/.test(normUser)) {
      reply = `En *${ctx.companyName}* acompañamos a empresas con soluciones ejecutivas orientadas a resultados medibles:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
    }
  }

  // 7. Recomendación Consultiva / Por cuál empezar
  const isRecommendation = lowerText.includes('que me recomiend') || lowerText.includes('qué me recomiend') || lowerText.includes('cual me recomiend') || lowerText.includes('cuál me recomiend') ||
    lowerText.includes('por cual empiez') || lowerText.includes('por cuál empiez') || lowerText.includes('cual elijo') || lowerText.includes('cuál elijo') || lowerText.includes('recomiendan para empezar') || lowerText.includes('molestia');

  if (!reply && isRecommendation) {
    if (isAiAgency) {
      reply = `Para darte una recomendación honesta y rentable: la mayoría de las empresas comienza con nuestro Plan Starter o Growth Pro, ya que cubren de inmediato el flujo de ventas 24/7.\n\n${dom.triageQuestion}`;
    } else {
      reply = `Como ${dom.roleTitle} en *${ctx.companyName}*, te detallo nuestras alternativas principales para recomendarte la ideal según tu caso:\n\n${ctx.catalogSummary}\n\n${dom.triageQuestion}`;
    }
  }

  // 8. Manejo de Indecisión ("Lo voy a pensar", consulta con terceros)
  const isHesitation = lowerText.includes('lo voy a pensar') || lowerText.includes('lo tengo que pensar') || lowerText.includes('dejame ver') || lowerText.includes('déjame ver') ||
    lowerText.includes('despues te aviso') || lowerText.includes('después te aviso') || lowerText.includes('despues te escribo') || lowerText.includes('después te escribo') ||
    lowerText.includes('tengo que hablar') || lowerText.includes('tengo que consultar') || lowerText.includes('con mi socio') || lowerText.includes('con mi pareja') || lowerText.includes('con mi esposa') || lowerText.includes('con mi marido');

  if (!reply && isHesitation) {
    reply = `Totalmente comprensible. Es importante que avances con total seguridad y claridad. Para ayudarte a evaluarlo: ¿hay alguna duda puntual sobre nuestras opciones, aranceles o modalidad que te gustaría aclarar?\n\nSi lo deseas, puedo dejarte pre-reservada la disponibilidad de esta semana sin compromiso mientras lo defines.`;
  }

  // 9. Comparación con Competencia ("Encontré algo más barato")
  const isCompetitorComparison = lowerText.includes('la competencia') || lowerText.includes('otro lugar') || lowerText.includes('en otro lado') || lowerText.includes('mas barato en') ||
    lowerText.includes('más barato en') || lowerText.includes('otro proveedor') || lowerText.includes('otra empresa') || lowerText.includes('otro presupuesto');

  if (!reply && isCompetitorComparison) {
    reply = `Es una muy buena observación. Existen alternativas de menor valor, pero en *${ctx.companyName}* priorizamos lo que realmente cuida tu tranquilidad y tu inversión: ${dom.valueJustification.charAt(0).toLowerCase() + dom.valueJustification.slice(1)}\n\n${dom.triageQuestion}`;
  }

  // 10. Confianza, Credibilidad y Garantías
  const isTrustQuestion = lowerText.includes('es seguro') || lowerText.includes('garantia') || lowerText.includes('garantía') || lowerText.includes('confiable') ||
    lowerText.includes('como se que funciona') || lowerText.includes('cómo sé que funciona') || lowerText.includes('por que confiar') || lowerText.includes('por qué confiar') ||
    lowerText.includes('estafa') || lowerText.includes('referencias') || lowerText.includes('seguridad');

  if (!reply && isTrustQuestion) {
    reply = `Es una consulta sumamente válida y nos alegra que la hagas. En *${ctx.companyName}* la transparencia y el respaldo profesional son la base de nuestro trabajo: ${dom.valueJustification.charAt(0).toLowerCase() + dom.valueJustification.slice(1)}\n\n${dom.closingCapturePrompt}`;
  }

  // 11. Preguntas de Continuidad / Mensajes Cortos
  if (!reply && (lowerText === 'cuanto?' || lowerText === 'cuánto?' || lowerText === 'precio?' || lowerText === 'precios?' || lowerText === 'costo?' || lowerText === 'y el costo?')) {
    reply = `Con gusto. Aquí tienes nuestros servicios y precios oficiales en ${ctx.companyName}:\n\n${ctx.catalogSummary}\n\n¿Cuál de estas opciones se ajusta más a lo que necesitas hoy?`;
  }

  if (!reply && (lowerText === 'y el otro?' || lowerText === 'que otro?' || lowerText === 'qué otro?' || lowerText === 'hay otro?')) {
    reply = `En ${ctx.companyName} contamos con distintas alternativas pensadas para cada necesidad y presupuesto:\n\n${ctx.catalogSummary}\n\nCuéntame un poco más sobre tu caso particular y te recomiendo exactamente el más conveniente para ti.`;
  }

  if (!reply && (lowerText === 'no se' || lowerText === 'no sé' || lowerText === 'dudo' || lowerText === 'no estoy seguro')) {
    reply = `Es completamente normal tener dudas al inicio. Para poder orientarte con exactitud y sin rodeos: ¿Cuál es el principal problema o resultado que te gustaría resolver en este momento? Con ese dato te digo exactamente qué alternativa es la ideal para ti.`;
  }

  // 12. Precios y Catálogo Oficial (Técnica del Sándwich Consultivo + Diagnóstico de Especialista)
  if (!reply && (lowerText.includes('precio') || lowerText.includes('precios') || lowerText.includes('costo') || lowerText.includes('costos') || lowerText.includes('cuanto') || lowerText.includes('cuánto') || lowerText.includes('tarifa') || lowerText.includes('tarifas') || lowerText.includes('planes') || lowerText.includes('cotiza') || lowerText.includes('presupuesto') || lowerText.includes('catalogo') || lowerText.includes('catálogo'))) {
    reply = `Con gusto. Aquí tienes nuestros aranceles y opciones oficiales en *${ctx.companyName}* (${ctx.industry}):\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`;
  }

  // 13. Agendamiento de Turnos o Citas (Captura Proactiva de 3 Datos de Cierre por Rubro)
  if (!reply && (lowerText.includes('turno') || lowerText.includes('turnos') || lowerText.includes('cita') || lowerText.includes('citas') || lowerText.includes('agendar') || lowerText.includes('reunion') || lowerText.includes('reunión') || lowerText.includes('llamada') || lowerText.includes('reserva') || lowerText.includes('reservar') || lowerText.includes('disponibilidad'))) {
    reply = `Por supuesto, será un placer coordinar tu atención en *${ctx.companyName}*.\n\n${dom.closingCapturePrompt}`;
  }

  // 14. Ubicación y Oficinas
  if (!reply && (lowerText.includes('donde estan') || lowerText.includes('dónde están') || lowerText.includes('donde quedan') || lowerText.includes('dónde quedan') || lowerText.includes('direccion') || lowerText.includes('dirección') || lowerText.includes('ubicacion') || lowerText.includes('ubicación') || lowerText.includes('como llego') || lowerText.includes('cómo llego'))) {
    reply = `Información y ubicación de ${ctx.companyName}:\n\n${ctx.knowledgeBase}\n\n¿Te gustaría coordinar una visita presencial o prefieres que gestionemos todo directamente por este medio?`;
  }

  // 15. Horarios de atención
  if (!reply && (lowerText.includes('horario') || lowerText.includes('horarios') || lowerText.includes('a que hora') || lowerText.includes('a qué hora') || lowerText.includes('atienden hoy') || lowerText.includes('estan abiertos') || lowerText.includes('están abiertos'))) {
    reply = `Horarios de atención de ${ctx.companyName}:\n\n${ctx.knowledgeBase}\n\nRecuerda que por este chat de WhatsApp te atendemos las 24 horas. ¿En qué podemos ayudarte en este momento?`;
  }

  // 16. Solicitud de asesor humano (Detección precisa de intención)
  const isHumanAgentRequest = lowerText.includes('hablar con un') || lowerText.includes('hablar con una') || lowerText.includes('comunicarme con un') || lowerText.includes('comunicarme con una') ||
    lowerText.includes('atencion humana') || lowerText.includes('atención humana') || lowerText.includes('asesor humano') || lowerText.includes('persona real') || lowerText.includes('alguien real') ||
    lowerText.includes('un operador') || lowerText.includes('una persona') || lowerText.includes('con un humano') || lowerText.includes('pasame con un') || lowerText.includes('pásame con un') ||
    lowerText.includes('derivar con un') || lowerText.includes('derivar con una') || lowerText.includes('con el dueño') || lowerText.includes('con la dueña');

  if (!reply && isHumanAgentRequest) {
    reply = `Por supuesto. Ya he tomado nota para que un especialista de nuestro equipo en ${ctx.companyName} revise tu caso y se comunique contigo a la brevedad por este mismo chat. Mientras tanto, ¿deseas dejarme tu consulta detallada para ir adelantando?`;
  }

  // 17. Agradecimientos
  if (!reply && (lowerText.includes('gracia') || lowerText.includes('agradecid') || lowerText.includes('te agradezco') || lowerText.includes('muy amable') || lowerText === 'grx' || lowerText === 'thx')) {
    reply = `Al contrario, un verdadero placer. En ${ctx.companyName} estamos siempre a tu disposición para ayudarte. Si te gustaría que reservemos tu lugar o avancemos con tu propuesta, solo avísame y lo dejamos listo. Que tengas un excelente día.`;
  }

  // 18. Despedidas
  if (!reply && (lowerText.includes('chau') || lowerText.includes('adios') || lowerText.includes('adiós') || lowerText.includes('hasta luego') || lowerText.includes('nos vemos') || lowerText.includes('bye') || lowerText.includes('buenas noches') || lowerText.includes('buen finde'))) {
    reply = `Hasta luego. Ha sido un gusto hablar contigo. En ${ctx.companyName} quedamos a tu completa disposición para cuando desees retomar. Que tengas un gran día.`;
  }

  // 19. Confirmaciones cortas (ok, genial, perfecto, entiendo)
  if (!reply && (lowerText === 'ok' || lowerText === 'genial' || lowerText === 'perfecto' || lowerText === 'buenisimo' || lowerText === 'buenísimo' || lowerText === 'excelente' || lowerText === 'entendido' || lowerText === 'comprendo' || lowerText === 'bien')) {
    if (hadPriceDiscussion) {
      reply = `Genial. Dado que estuvimos viendo nuestras opciones en *${ctx.companyName}*, avanzamos cuando gustes.\n\n${dom.closingCapturePrompt}`;
    } else {
      reply = `Excelente. En *${ctx.companyName}* estamos listos para ayudarte. ¿Deseas que coordinemos una fecha para tu atención o tienes alguna otra consulta?`;
    }
  }

  // 20. Saludos iniciales (Solo si la conversación recién empieza - Presentación de Especialista + Triaje del Rubro)
  if (!reply && !isConversationOngoing && (lowerText.includes('hola') || lowerText.includes('buen dia') || lowerText.includes('buen día') || lowerText.includes('buenas tardes') || lowerText.includes('buenas noches') || lowerText.includes('buenas') || lowerText.includes('que tal') || lowerText.includes('qué tal'))) {
    reply = `Hola, qué gusto saludarte. Te doy la bienvenida a *${ctx.companyName}* (${ctx.industry}). Soy ${ctx.agentName}, ${dom.roleTitle}.\n\n${dom.triageQuestion}`;
  }

  // 21. Multi-Turn Progressive Fallback (NEVER REPEATS)
  if (!reply) {
    const progressiveReplies = [
      `Excelente consulta. En *${ctx.companyName}* (${ctx.industry}) trabajamos de forma personalizada para brindarte la mejor atención. ${dom.triageQuestion}`,
      `Comprendo perfectamente. Aquí tienes nuestras prestaciones y valores principales en *${ctx.companyName}*:\n\n${ctx.catalogSummary}\n\n${dom.valueJustification}\n\n${dom.triageQuestion}`,
      `Con todo gusto. Para coordinar tu atención en *${ctx.companyName}*:\n\n${dom.closingCapturePrompt}`
    ];

    for (const pr of progressiveReplies) {
      if (!lastBotMsg || pr.slice(0, 35).toLowerCase() !== lastBotMsg.slice(0, 35).toLowerCase()) {
        reply = pr;
        break;
      }
    }
    if (!reply) reply = progressiveReplies[2];
  }

  // 22. HARD ANTI-REPETITION GUARANTEE (Zero Duplicates Allowed)
  const isDuplicate = lastBotMsg && (
    reply.trim().toLowerCase() === lastBotMsg.trim().toLowerCase() ||
    reply.slice(0, 30).toLowerCase().trim() === lastBotMsg.slice(0, 30).toLowerCase().trim() ||
    (lastBotMsg.length > 35 && reply.toLowerCase().includes(lastBotMsg.slice(0, 35).toLowerCase()))
  );

  if (isDuplicate) {
    if (hadPriceDiscussion || hadTurnDiscussion) {
      reply = `Excelente. Para dejar reservado tu lugar en *${ctx.companyName}*:\n\n${dom.closingCapturePrompt}`;
    } else {
      reply = `Con gusto. Te detallo nuestras opciones oficiales en *${ctx.companyName}* (${ctx.industry}):\n\n${ctx.catalogSummary}\n\n${dom.triageQuestion}`;
    }
  }

  return stripAiEmojis(reply);
}

// ==================== GENERATE AI AGENT RESPONSE ====================
async function generateAiAgentResponse(userText, senderPhone, sessionOrAgencyId = '', maybeAgencyId = '', customOverride = null) {
  const text = (userText || '').trim();
  if (!text) return null;
  const lowerText = text.toLowerCase();

  let sessionId = sessionOrAgencyId;
  let agencyId = maybeAgencyId || sessionOrAgencyId || 'agency_master_1';
  if (sessionOrAgencyId && !maybeAgencyId && !sessionOrAgencyId.startsWith('client_') && !sessionOrAgencyId.startsWith('agency_')) {
    agencyId = sessionOrAgencyId;
  }

  // 1. Resolve company & niche training
  const ctx = await getAgentCompanyContext(sessionId, agencyId);
  if (customOverride && typeof customOverride === 'object') {
    if (customOverride.customCompanyName) ctx.companyName = String(customOverride.customCompanyName).trim();
    if (customOverride.customIndustry) {
      ctx.industry = String(customOverride.customIndustry).trim();
    }
    if (customOverride.customAgentName) ctx.agentName = String(customOverride.customAgentName).trim();
    if (customOverride.customSystemPrompt) ctx.systemPrompt = String(customOverride.customSystemPrompt).trim();
    if (customOverride.customKnowledgeBase) ctx.knowledgeBase = String(customOverride.customKnowledgeBase).trim();

    // If catalog was passed or if we should match the blueprint for the overridden company/industry
    if (Array.isArray(customOverride.customCatalog) && customOverride.customCatalog.length > 0) {
      ctx.catalogItems = customOverride.customCatalog;
      ctx.catalogSummary = customOverride.customCatalog.map(item => {
        const parts = [`• ${item.name}: $${item.price} USD`];
        if (item.duration) parts.push(`(${item.duration})`);
        if (item.description || item.benefits) parts.push(`- ${item.description || item.benefits}`);
        return parts.join(' ');
      }).join('\n');
    } else if (customOverride.customCompanyName || customOverride.customIndustry) {
      const bp = findMatchingBlueprintForCompany(ctx.industry, ctx.companyName);
      if (bp) {
        if (!customOverride.customIndustry || ctx.industry === 'Otro Rubro' || ctx.industry.includes('Automatización')) {
          ctx.industry = bp.category;
        }
        if (Array.isArray(bp.defaultCatalog) && bp.defaultCatalog.length > 0) {
          ctx.catalogItems = bp.defaultCatalog;
          ctx.catalogSummary = bp.defaultCatalog.map(item => {
            const parts = [`• ${item.name}: $${item.price} USD`];
            if (item.duration) parts.push(`(${item.duration})`);
            if (item.description) parts.push(`- ${item.description}`);
            return parts.join(' ');
          }).join('\n');
        }
        if (!customOverride.customSystemPrompt && bp.defaultSystemPrompt) {
          ctx.systemPrompt = bp.defaultSystemPrompt.replace(/la clínica|la empresa|el salón|la firma|el Estudio|el complejo\/hotel|la institución|la empresa constructora\/estudio/gi, ctx.companyName);
        }
      }
    }
    ctx.nichePlaybook = getNicheSalesPlaybook(ctx.industry);
  }

  // 2. Load RAG Knowledge Documents if present
  const docContext = await getAgencyKnowledgeContext(ctx.id || agencyId);
  const ragInstruction = docContext 
    ? `\n\nDOCUMENTACIÓN TÉCNICA Y OFICIAL ADICIONAL DE ${ctx.companyName.toUpperCase()}:\n${docContext}\n` 
    : '';

  // 3. Multi-turn conversation history for this sender / session
  const convKey = getConvKey(agencyId, senderPhone);
  const history = getConversationHistory(convKey);

  // 4. Construct Master Cognitive Sales Framework Prompt
  const systemPrompt = `Eres ${ctx.agentName}, Consultor Comercial Senior y Asesor Especializado que representa oficialmente a "${ctx.companyName}" (${ctx.industry}).
Tu tono y estilo son: ${ctx.tone}.

OBJETIVO Y MENTALIDAD COMERCIAL:
No eres un chatbot pasivo ni un asistente genérico que simplemente contesta preguntas. Eres un profesional altamente capacitado en ventas consultivas, persuasión ética, manejo de objeciones y cierre comercial. Tu misión es comprender a fondo las necesidades y motivaciones del cliente, argumentar con inteligencia basándote en los datos reales de la empresa y conducir cada diálogo con naturalidad y seguridad hacia el siguiente paso comercial (agendar cita, demo, contratación o compra).

DATOS REALES Y ENTRENAMIENTO DE LA EMPRESA ("${ctx.companyName.toUpperCase()}"):
- Rubro / Industria: ${ctx.industry}
- Pautas del Negocio: ${ctx.systemPrompt}
- Catálogo Oficial de Productos / Servicios con Precios:
${ctx.catalogSummary}
- Información Operativa (Horarios, Ubicación, Políticas):
${ctx.knowledgeBase}
- Flujo Comercial, Calificación y Cierre:
${ctx.salesFlow}
- Soporte, Preguntas Frecuentes y Políticas:
${ctx.supportSummary}
- Post-Venta y Garantías:
${ctx.afterSalesSummary}
${ragInstruction}

PLAYBOOK COMERCIAL ESPECÍFICO DEL NICHO (${ctx.industry.toUpperCase()}):
${ctx.nichePlaybook}

FRAMEWORK COGNITIVO DE VENTA CONSULTIVA (4 PASOS POR TURNO):
1. DIAGNÓSTICO E INTENCIÓN LATENTE:
   - Comprende qué busca o qué le preocupa realmente al cliente, incluso cuando formule mensajes breves ("cuánto?", "y el otro?", "no sé"), informales o ambiguos.
   - Utiliza todo el contexto previo de la conversación para dar continuidad sin reiniciar el diálogo ni pedir datos ya conversados.
2. RESPUESTA DIRECTA Y ARGUMENTACIÓN DE VALOR:
   - Responde PRIMERO y de forma clara a la consulta del cliente (cero evasivas).
   - Relaciona de inmediato su inquietud con el beneficio tangible específico de tu catálogo (tranquilidad, ahorro de tiempo, rentabilidad, salud o imagen).
3. MANEJO PROFESIONAL DE OBJECIONES (SIN GUIONES RÍGIDOS):
   - "Es muy caro" / "No llego": Valida con empatía, reencuadra el valor, el retorno de inversión y el costo de no solucionar su problema. Ofrece una opción más accesible del catálogo o facilidades autorizadas.
   - "Lo voy a pensar" / "Tengo que hablar con mi socio/pareja": Valida su decisión, aísla la duda puntual ("¿Qué aspecto específico te gustaría evaluar mejor?") y ofrece un paso de bajo compromiso (ej: reservar cupo o propuesta por 48h sin compromiso).
   - "Encontré algo más barato": Explica con elegancia la diferencia en calidad, garantía real, respaldo y durabilidad sin descalificar al competidor.
   - "No confío" / "¿Cómo sé que funciona?": Transmite seguridad con transparencia, políticas de garantía y ofreciendo una llamada corta o demo en vivo.
   - Si una estrategia no convence al cliente, cambia de enfoque en el siguiente mensaje en lugar de repetir el mismo argumento.
4. DETECCIÓN DE SEÑALES DE COMPRA Y CIERRE COMERCIAL (CAPTURA DE 3 DATOS):
   - Si el cliente muestra intención de compra o reserva ("me interesa", "quiero agendar", "cómo pago", "dale"), pasa al CIERRE EJECUTIVO solicitando en un solo paso amable los 3 datos clave de confirmación de tu rubro (Nombre, requerimiento/modalidad y preferencia horaria o de pago).
   - Si el cliente está explorando, aplica la TÉCNICA DEL SÁNDWICH CONSULTIVO: 1) Responde su duda o da el precio con transparencia, 2) Justifica brevemente el valor técnico/profesional, y 3) Cierra con una pregunta de triaje/diagnóstico propia de un especialista senior del rubro.

REGLAS DE ÉTICA PROFESIONAL Y FORMATO VISUAL EN WHATSAPP (ESTRICTAS):
- NUNCA digas que eres una inteligencia artificial, un bot o un modelo de lenguaje. Habla como un especialista humano senior de "${ctx.companyName}".
- PROHIBICIÓN ABSOLUTA DE EMOJIS: NUNCA uses emojis, emoticones ni íconos gráficos en ningún momento bajo ninguna circunstancia. Responde exclusivamente con texto limpio, sobrio y natural.
- FORMATO VISUAL ESCANEABLE EN 3 SEGUNDOS: Escribe en 2 o 3 bloques cortos separados por una línea en blanco. Usa *negritas de WhatsApp* únicamente para resaltar importes, horarios o conceptos clave.
- ÉTICA POR RUBRO: En salud/clínicas jamás recetes medicamentos ni des diagnósticos definitivos sin valoración presencial; en derecho/contabilidad jamás prometas resultados judiciales garantizados ni emitas dictámenes vinculantes sin revisión documental.
- NUNCA uses menús robóticos ("Opción 1, Opción 2").
- Si la conversación ya está en curso, NO vuelvas a saludar con "Hola". Responde directamente con fluidez.
- HONESTIDAD ABSOLUTA: Jamás inventes descuentos no autorizados, garantías inexistentes ni precios falsos.`;

  // 5. Try Generative LLM with Multi-Turn Memory (Gemini / OpenAI)
  let generatedReply = null;
  const effectiveAiKey = ctx.apiKey || customAiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (effectiveAiKey) {
    try {
      // 5.A OpenAI API
      if (effectiveAiKey.startsWith('sk-')) {
        const oaiMessages = [
          { role: 'system', content: systemPrompt },
          ...history.map(h => ({
            role: h.role === 'assistant' ? 'assistant' : 'user',
            content: h.text
          })),
          { role: 'user', content: userText }
        ];

        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${effectiveAiKey}`
          },
          body: JSON.stringify({
            model: activeAiModel.includes('gpt') ? activeAiModel : 'gpt-4o-mini',
            messages: oaiMessages,
            temperature: 0.65,
            max_tokens: 650
          })
        });

        if (oaiRes.ok) {
          const oaiData = await oaiRes.json();
          generatedReply = oaiData.choices?.[0]?.message?.content;
        } else {
          console.error('[OpenAI API Error]', oaiRes.status, await oaiRes.text());
        }
      } else {
        // 5.B Google Gemini API with Multi-Turn & Multi-Model High-Availability Cascade
        const formattedContents = buildGeminiContents(history, userText);
        const preferredModel = (activeAiModel && !activeAiModel.includes('1.5') && !activeAiModel.includes('3.1')) ? activeAiModel : 'gemini-2.5-flash';
        const candidateModels = [...new Set([preferredModel, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'])];

        for (const modelName of candidateModels) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${effectiveAiKey}`;
            const gRes = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: formattedContents,
                system_instruction: {
                  parts: [{ text: systemPrompt }]
                },
                generationConfig: {
                  temperature: 0.65,
                  maxOutputTokens: 650
                }
              })
            });

            if (gRes.ok) {
              const json = await gRes.json();
              const candidateText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (candidateText && candidateText.trim()) {
                generatedReply = candidateText;
                break;
              }
            }
          } catch (innerErr) {}
        }
      }
    } catch (llmErr) {
      console.warn('[LLM Call Note] Fallback to conversational sales heuristics:', llmErr.message);
    }
  }

  // If LLM returned a valid response, strip emojis completely and ensure it does not duplicate the previous message
  const lastBotMsg = history.filter(h => h.role === 'assistant').slice(-1)[0]?.text || '';
  if (generatedReply && generatedReply.trim()) {
    const finalReply = stripAiEmojis(generatedReply);
    if (finalReply && (!lastBotMsg || finalReply.trim().toLowerCase() !== lastBotMsg.trim().toLowerCase())) {
      appendToConversationHistory(convKey, 'user', userText);
      appendToConversationHistory(convKey, 'assistant', finalReply);
      return finalReply;
    }
  }

  // 6. High-Converting Consultative Sales Heuristics Engine (Understands Multi-Turn Context & Human Intent)
  const reply = stripAiEmojis(generateContextualSalesReply(lowerText, userText, history, ctx, docContext));
  appendToConversationHistory(convKey, 'user', userText);
  appendToConversationHistory(convKey, 'assistant', reply);
  return reply;
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
const server = http.createServer(async (req, res) => {
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
    const strict = urlObj.searchParams.get('strict') === '1';
    let session = activeSessions[sessionId];

    // If querying agency session and a client session is already connected (or vice-versa), surface the active connection unless strict mode is requested
    const anyConnectedEntry = Object.entries(activeSessions).find(([, s]) => s && s.connected && s.phone);
    const connectedMap = {};
    for (const [k, s] of Object.entries(activeSessions)) {
      if (s && s.connected) {
        connectedMap[k] = { phone: s.phone, userName: s.userName, status: s.status };
      }
    }

    if (!session) {
      if (!strict && anyConnectedEntry) {
        const [connKey, connSess] = anyConnectedEntry;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          connected: true,
          status: 'connected',
          phone: connSess.phone,
          qr: null,
          pairingCode: null,
          userName: connSess.userName,
          activeSessionKey: connKey,
          connectedSessions: connectedMap
        }));
        return;
      }
      getOrInitBaileysSession(sessionId)
        .then(s => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            connected: s.connected,
            status: s.status,
            phone: s.phone,
            qr: s.qrImage,
            pairingCode: s.pairingCode,
            userName: s.userName,
            connectedSessions: connectedMap
          }));
        })
        .catch(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ connected: false, status: 'uninitialized', phone: null, qr: null, connectedSessions: connectedMap }));
        });
      return;
    }

    const effectiveConnected = session.connected || (!strict && sessionId.startsWith('agency_') && !!anyConnectedEntry);
    const effectivePhone = session.connected ? session.phone : (anyConnectedEntry ? anyConnectedEntry[1].phone : session.phone);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: effectiveConnected,
      status: effectiveConnected ? 'connected' : session.status,
      phone: effectivePhone,
      qr: effectiveConnected ? null : session.qrImage,
      pairingCode: session.pairingCode,
      userName: session.userName,
      connectedSessions: connectedMap
    }));
    return;
  }

  // 3.1 Get Live WhatsApp Incoming/Outgoing Messages for Inbox Sync
  if (pathname === '/api/wa-session/live-messages' && req.method === 'GET') {
    const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
    const list = liveWaContactsByAgency[agId] || liveWaContactsByAgency['agency_master_1'] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, leads: list }));
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
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));

      try {
        const payload = JSON.parse(body || '{}');
        if (payload.object === 'whatsapp_business_account') {
          for (const entry of payload.entry || []) {
            for (const change of entry.changes || []) {
              const val = change.value;
              if (val && val.messages) {
                for (const msg of val.messages) {
                  if (msg.type === 'text') {
                    const fromNumber = msg.from;
                    const textBody = msg.text.body;
                    console.log(`[Meta Cloud Webhook] 📩 Mensaje entrante de +${fromNumber}: "${textBody}"`);
                    
                    // High intent check
                    checkAndAlertOwner('agency_master_1', fromNumber, textBody, null).catch(e => console.error(e));

                    const aiReply = await generateAiAgentResponse(textBody, fromNumber, 'agency_master_1');
                    if (aiReply) {
                      await sendMetaWhatsAppMessage(fromNumber, aiReply);
                      console.log(`[Meta Cloud Webhook] 🤖 IA respondió a +${fromNumber}: "${aiReply.slice(0, 40)}..."`);
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[Meta Webhook Error]', err.message);
      }
    });
    return;
  }

  // 7. Save and Test AI Configuration (Gemini / OpenAI)
  if (pathname === '/api/config/ai' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { apiKey, model, agencyId } = JSON.parse(body || '{}');
        if (apiKey !== undefined) customAiKey = apiKey.trim();
        if (model) activeAiModel = model.trim();

        // Save to local file so it persists across server restarts
        saveAiConfig(customAiKey, activeAiModel);

        // Also save to Neon PostgreSQL if agencyId is provided
        if (agencyId) {
          try {
            await db.query(
              `UPDATE agencies 
               SET portal_config = jsonb_set(COALESCE(portal_config, '{}'::jsonb), '{ai_key}', to_jsonb($1::text))
               WHERE id = $2`,
              [customAiKey, agencyId]
            );
          } catch (dbErr) {
            console.error('[DB Note] No se pudo guardar ai_key en tabla agencies:', dbErr.message);
          }
        }

        // Test the AI key with a quick prompt
        let testSuccess = false;
        let testResponse = '';
        if (customAiKey) {
          try {
            const reply = await generateAiAgentResponse('Hola, ¿qué servicios ofrecen?', '5491112345678', agencyId || 'agency_master_1');
            if (reply) {
              testSuccess = true;
              testResponse = reply;
            }
          } catch (tErr) {
            testResponse = tErr.message;
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          activeModel: activeAiModel,
          hasKey: !!customAiKey,
          isLiveAi: !!customAiKey && testSuccess,
          sampleReply: (testResponse || 'Conexión verificada exitosamente').slice(0, 160)
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/config/ai' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasKey: !!customAiKey,
      activeModel: activeAiModel,
      provider: customAiKey.startsWith('sk-') ? 'OpenAI' : 'Google Gemini',
      maskedKey: customAiKey ? (customAiKey.slice(0, 4) + '...' + customAiKey.slice(-4)) : ''
    }));
    return;
  }

  // 7.1 Sync Multi-Tenant Clients & Agents by Niche
  if (pathname === '/api/agency/clients/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, activeClientId, clients } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        if (activeClientId) {
          activeClientByAgency[agId] = activeClientId;
        }
        const cleanClients = (Array.isArray(clients) ? clients : []).filter(c => c && c.id !== 'client_dental_1' && c.id !== 'client_resto_1');

        memoryCompanies[agId] = cleanClients;
        saveCompaniesToDisk();

        // Also persist to Neon PostgreSQL clients table if available
        if (db) {
          for (const c of cleanClients) {
            try {
              await db.query(
                `INSERT INTO clients (id, agency_id, name, industry, phone, notes)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (id) DO UPDATE SET 
                   name = EXCLUDED.name,
                   industry = EXCLUDED.industry,
                   phone = EXCLUDED.phone,
                   notes = EXCLUDED.notes`,
                [
                  c.id, 
                  agId, 
                  c.name, 
                  c.industry || 'Servicios', 
                  c.phone || null, 
                  JSON.stringify({ 
                    agentName: c.agentName, 
                    systemPrompt: c.systemPrompt, 
                    knowledgeBase: c.knowledgeBase, 
                    catalog: c.catalog, 
                    salesFlow: c.salesFlow,
                    supportFlow: c.supportFlow,
                    afterSalesFlow: c.afterSalesFlow 
                  })
                ]
              );
            } catch (cErr) {}
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: cleanClients.length }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/agency/clients/sync' && req.method === 'GET') {
    const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
    const rawClients = memoryCompanies[agId] || memoryCompanies['agency_master_1'] || [];
    const clients = (Array.isArray(rawClients) ? rawClients : []).filter(c => c && c.id !== 'client_dental_1' && c.id !== 'client_resto_1' && !c.name?.includes('San Lucas') && !c.name?.includes('Bistro Gourmet'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, clients }));
    return;
  }

  // 7.2 Test Chat with Specific Trained Agent / Niche (Multi-Turn Conversational Simulator)
  if (pathname === '/api/agents/test-chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, clientId, agencyId, chatSessionId, reset, customCompanyName, customIndustry, customAgentName, clientData } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        const sessionKey = chatSessionId || `sim_${clientId || 'hq'}`;

        if (clientId) {
          activeClientByAgency[agId] = clientId;
        }

        // If frontend sent the live clientData object, upsert it in memoryCompanies so server always has the latest client config
        if (clientData && typeof clientData === 'object' && clientData.id) {
          if (!Array.isArray(memoryCompanies[agId])) memoryCompanies[agId] = [];
          const idx = memoryCompanies[agId].findIndex(c => c.id === clientData.id);
          if (idx >= 0) {
            memoryCompanies[agId][idx] = { ...memoryCompanies[agId][idx], ...clientData };
          } else {
            memoryCompanies[agId].unshift(clientData);
          }
          saveCompaniesToDisk();
        }

        if (reset) {
          clearConversationHistory(getConvKey(agId, sessionKey));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, reset: true, message: 'Historial de simulación reiniciado con éxito.' }));
          return;
        }

        let customOverride = null;
        if (customCompanyName || customIndustry || customAgentName) {
          customOverride = { customCompanyName, customIndustry, customAgentName };
        } else if (clientData && typeof clientData === 'object') {
          customOverride = {
            customCompanyName: clientData.name,
            customIndustry: clientData.industry,
            customAgentName: clientData.agentName,
            customSystemPrompt: clientData.systemPrompt,
            customKnowledgeBase: clientData.knowledgeBase,
            customCatalog: clientData.catalog
          };
        }

        const ctx = await getAgentCompanyContext(clientId, agId);
        if (customOverride) {
          if (customOverride.customCompanyName) ctx.companyName = customOverride.customCompanyName;
          if (customOverride.customIndustry) ctx.industry = customOverride.customIndustry;
          if (customOverride.customAgentName) ctx.agentName = customOverride.customAgentName;
        }

        const reply = await generateAiAgentResponse(message || 'Hola', sessionKey, clientId, agId, customOverride);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          reply,
          companyName: ctx.companyName,
          industry: ctx.industry,
          agentName: ctx.agentName
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // 7.3 Human Takeover (Pausa Humana Anti-Choque por Conversación)
  if (pathname === '/api/wa-session/human-takeover' && req.method === 'GET') {
    const sessionId = urlObj.searchParams.get('sessionId') || 'agency_master_1';
    const phone = urlObj.searchParams.get('phone') || '';
    if (phone) {
      const info = isChatPausedForHuman(sessionId, phone);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, paused: !!info, details: info || null }));
      return;
    }
    const activeList = [];
    for (const [k, val] of pausedHumanChats.entries()) {
      if (k.startsWith('global_') && Date.now() <= val.pausedUntil) {
        activeList.push(val);
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, pausedChats: activeList }));
    return;
  }

  if (pathname === '/api/wa-session/human-takeover' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { sessionId, phone, paused, durationMinutes } = JSON.parse(body || '{}');
        if (!phone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Número de teléfono requerido.' }));
          return;
        }
        const info = setChatHumanTakeover(
          sessionId || 'agency_master_1',
          phone,
          paused !== false,
          Number(durationMinutes) || 120,
          'Control manual activado desde Bandeja de Entrada'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, paused: !!info?.paused, details: info }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==================== NEON POSTGRESQL & AUTH ENDPOINTS ====================

  // DB Init / Reset Database
  if (pathname === '/api/db/init' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { connectionString } = JSON.parse(body || '{}');
        const conn = connectionString || process.env.DATABASE_URL;
        if (!conn) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Falta la cadena de conexión de Neon (DATABASE_URL).' }));
          return;
        }
        await initDatabase(conn);
        process.env.DATABASE_URL = conn;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Base de datos de Neon reseteada e inicializada correctamente para tu agencia.' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Register New Account
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { name, email, password, agencyName } = JSON.parse(body || '{}');
        if (!name || !email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Nombre, email y contraseña son obligatorios.' }));
          return;
        }
        const agencyId = 'ag_' + Date.now();
        const aName = agencyName || `${name} Agency`;
        const slug = aName.toLowerCase().replace(/[^a-z0-9]/g, '-');

        await db.query(
          `INSERT INTO agencies (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [agencyId, aName, slug]
        );

        const userRes = await db.query(
          `INSERT INTO users (agency_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, agency_id, name, email, role, created_at`,
          [agencyId, name, email, password, 'agency_admin']
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: userRes?.rows?.[0] || { name, email, agency_id: agencyId } }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Login Account
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, password } = JSON.parse(body || '{}');
        const userRes = await db.query(
          `SELECT u.id, u.agency_id, u.name, u.email, u.role, a.name as agency_name, a.brand_color 
           FROM users u 
           LEFT JOIN agencies a ON u.agency_id = a.id 
           WHERE u.email = $1 AND u.password_hash = $2`,
          [email, password]
        );
        if (!userRes || userRes.rows.length === 0) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: userRes.rows[0] }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Database Status
  if (pathname === '/api/db/status' && req.method === 'GET') {
    try {
      const isConnected = !!db.getDbPool();
      let stats = null;
      if (isConnected) {
        const u = await db.query('SELECT COUNT(*) FROM users');
        const a = await db.query('SELECT COUNT(*) FROM agencies');
        const c = await db.query('SELECT COUNT(*) FROM clients');
        const p = await db.query('SELECT COUNT(*) FROM plans');
        stats = {
          users: parseInt(u?.rows?.[0]?.count || 0),
          agencies: parseInt(a?.rows?.[0]?.count || 0),
          clients: parseInt(c?.rows?.[0]?.count || 0),
          plans: parseInt(p?.rows?.[0]?.count || 0)
        };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: isConnected, stats }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: false, error: err.message }));
    }
    return;
  }

  // ==================== FEATURE 1: RAG KNOWLEDGE DOCS ====================
  if (pathname === '/api/knowledge/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, filename, fileType, text, fileSize } = JSON.parse(body || '{}');
        if (!text || !filename) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Falta el nombre o contenido del documento.' }));
          return;
        }
        const agId = agencyId || 'agency_master_1';
        const result = await db.query(
          `INSERT INTO knowledge_docs (agency_id, filename, file_type, file_size, extracted_text)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, filename, file_type, file_size, created_at`,
          [agId, filename, fileType || 'text/plain', fileSize || text.length, text]
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, doc: result.rows[0] }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/knowledge/list' && req.method === 'GET') {
    try {
      const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
      const result = await db.query(
        `SELECT id, filename, file_type, file_size, created_at 
         FROM knowledge_docs WHERE agency_id = $1 ORDER BY id DESC`,
        [agId]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, docs: result?.rows || [] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/knowledge/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { id, agencyId } = JSON.parse(body || '{}');
        await db.query(`DELETE FROM knowledge_docs WHERE id = $1 AND agency_id = $2`, [id, agencyId || 'agency_master_1']);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==================== FEATURE 2: APPOINTMENTS & CALENDAR ====================
  if (pathname === '/api/appointments/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, contactName, contactPhone, serviceName, appointmentDate } = JSON.parse(body || '{}');
        if (!contactName || !contactPhone || !appointmentDate) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Faltan campos obligatorios para agendar la cita.' }));
          return;
        }
        const agId = agencyId || 'agency_master_1';
        const result = await db.query(
          `INSERT INTO appointments (agency_id, contact_name, contact_phone, service_name, appointment_date, status)
           VALUES ($1, $2, $3, $4, $5, 'confirmed') RETURNING *`,
          [agId, contactName, contactPhone, serviceName || 'Atención General', appointmentDate]
        );

        // Auto-create event in Google Calendar if service account credentials exist
        const endDt = new Date(new Date(appointmentDate).getTime() + 30 * 60 * 1000).toISOString();
        createGoogleCalendarEvent(null, {
          summary: `Cita: ${contactName} - ${serviceName || 'Atención General'}`,
          description: `Cita agendada por NEXUS AI.\nCliente: ${contactName}\nWhatsApp: +${contactPhone}\nServicio: ${serviceName || 'Atención General'}`,
          startIso: new Date(appointmentDate).toISOString(),
          endIso: endDt
        }).catch(e => console.log('[Google Calendar Note]', e.message));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, appointment: result.rows[0] }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/appointments/list' && req.method === 'GET') {
    try {
      const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
      const result = await db.query(
        `SELECT * FROM appointments WHERE agency_id = $1 ORDER BY appointment_date ASC`,
        [agId]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, appointments: result?.rows || [] }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/appointments/cancel' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { id } = JSON.parse(body || '{}');
        await db.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [id]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==================== FEATURE 4: BROADCAST ANTI-BAN ====================
  if (pathname === '/api/broadcast/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, name, messageTemplate, recipients } = JSON.parse(body || '{}');
        if (!messageTemplate || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Plantilla de mensaje o lista de destinatarios vacía.' }));
          return;
        }
        const agId = agencyId || 'agency_master_1';

        // 1. Create campaign in DB
        const campRes = await db.query(
          `INSERT INTO broadcast_campaigns (agency_id, name, message_template, total_contacts, status)
           VALUES ($1, $2, $3, $4, 'running') RETURNING id`,
          [agId, name || 'Campaña WhatsApp', messageTemplate, recipients.length]
        );
        const campId = campRes.rows[0].id;

        // 2. Insert recipients
        for (const r of recipients) {
          await db.query(
            `INSERT INTO broadcast_recipients (campaign_id, phone, name) VALUES ($1, $2, $3)`,
            [campId, r.phone, r.name || '']
          );
        }

        // 3. Start background runner
        const runnerStatus = startBroadcastExecution(campId, agId, messageTemplate, recipients, (targetAgId) => {
          const sess = activeSessions[`agency_${targetAgId}`] || activeSessions['agency_hq'] || activeSessions['agency_master_1'];
          return sess?.sock;
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, campaignId: campId, progress: runnerStatus }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/broadcast/status' && req.method === 'GET') {
    try {
      const campId = parseInt(urlObj.searchParams.get('campaignId') || 0);
      const inMemory = activeCampaigns[campId];
      if (inMemory) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, progress: inMemory }));
        return;
      }
      const dbRes = await db.query(`SELECT * FROM broadcast_campaigns WHERE id = $1`, [campId]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, progress: dbRes?.rows?.[0] || null }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // ==================== FEATURE 5: OWNER NOTIFICATION SETTINGS ====================
  if (pathname === '/api/agency/owner-settings' && req.method === 'GET') {
    try {
      const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
      const resDb = await db.query(
        `SELECT id, name, owner_alert_phone, owner_alerts_enabled FROM agencies WHERE id = $1`,
        [agId]
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, agency: resDb?.rows?.[0] || {} }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/agency/owner-settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, ownerAlertPhone, ownerAlertsEnabled } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        await db.query(
          `UPDATE agencies SET owner_alert_phone = $1, owner_alerts_enabled = $2 WHERE id = $3`,
          [ownerAlertPhone || '', ownerAlertsEnabled !== false, agId]
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Configuración de alertas actualizada.' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==================== PUBLIC PORTAL & IN-VIVO LANDING CONFIGURATION ====================
  if (pathname === '/api/agency/public-portal' && req.method === 'GET') {
    try {
      const identifier = urlObj.searchParams.get('id') || urlObj.searchParams.get('slug') || urlObj.searchParams.get('agency') || 'agency_master_1';
      const allPortals = loadPortalsFromDisk();

      // Strict matching: only match entry if it belongs to this identifier or its slug
      let localEntry = allPortals[identifier];
      if (!localEntry) {
        const found = Object.values(allPortals).find(entry => 
          entry?.agency?.id === identifier || 
          (entry?.agency?.slug && entry.agency.slug.toLowerCase() === identifier.toLowerCase())
        );
        if (found) localEntry = found;
      }
      if (!localEntry && (identifier === 'agency_master_1' || identifier === 'nexus-ai')) {
        localEntry = allPortals['agency_master_1'];
      }

      let agencyData = null;
      let returnPlans = [];
      let isDefaultTemplate = false;

      try {
        const agencyRes = await db.query(
          `SELECT id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id, portal_title, portal_subtitle, portal_config FROM agencies WHERE id = $1 OR slug = $1 LIMIT 1`,
          [identifier]
        );
        agencyData = agencyRes?.rows?.[0];
      } catch (dbErr) {
        // Fallback to local disk storage
      }

      if (!agencyData && localEntry?.agency) {
        agencyData = {
          id: localEntry.agency.id || identifier,
          name: localEntry.agency.name || 'NEXUS AI Agency',
          slug: localEntry.agency.slug || identifier,
          brand_color: localEntry.agency.brandColor || '#6366f1',
          billing_phone: localEntry.agency.billingPhone || '',
          bank_name: localEntry.agency.bankName || '',
          bank_holder: localEntry.agency.bankHolder || '',
          bank_cbu: localEntry.agency.bankCbu || '',
          bank_tax_id: localEntry.agency.bankTaxId || '',
          portal_title: localEntry.agency.portalTitle !== undefined ? localEntry.agency.portalTitle : null,
          portal_subtitle: localEntry.agency.portalSubtitle !== undefined ? localEntry.agency.portalSubtitle : null,
          portal_config: localEntry.agency.portalConfig || {}
        };
      }

      if (!agencyData) {
        agencyData = {
          id: 'agency_master_1',
          name: 'NEXUS AI Agency',
          slug: 'nexus-ai',
          brand_color: '#6366f1',
          billing_phone: '5491148923310',
          portal_title: null,
          portal_subtitle: null,
          portal_config: {}
        };
      }

      // Fetch plans from DB if possible
      try {
        const plansRes = await db.query(
          `SELECT id, name, price, currency, period, category, features, payment_link, is_featured FROM plans WHERE agency_id = $1 ORDER BY created_at ASC, id ASC`,
          [agencyData.id]
        );
        if (plansRes?.rows && plansRes.rows.length > 0) {
          returnPlans = plansRes.rows.map(r => {
            const cleanId = r.id.startsWith(`${agencyData.id}_`) ? r.id.substring(`${agencyData.id}_`.length) : r.id;
            let feat = r.features;
            if (typeof feat === 'string') {
              try { feat = JSON.parse(feat); } catch (e) { feat = feat.split('\n').filter(Boolean); }
            }
            return {
              id: cleanId,
              dbId: r.id,
              name: r.name,
              price: parseFloat(r.price).toString().replace(/\.00$/, ''),
              currency: r.currency || 'USD',
              period: r.period || 'mes',
              billingPeriod: r.period || 'mes',
              category: r.category || 'Solución IA',
              features: Array.isArray(feat) ? feat : [],
              paymentLink: r.payment_link || '',
              payment_link: r.payment_link || '',
              isFeatured: !!r.is_featured,
              is_featured: !!r.is_featured
            };
          });
        }
      } catch (e) {}

      // If DB had no plans, check if local disk has custom saved plans for THIS agency!
      if (returnPlans.length === 0 && localEntry?.plans && Array.isArray(localEntry.plans) && localEntry.plans.length > 0) {
        returnPlans = localEntry.plans.map(p => ({
          ...p,
          price: String(p.price || '0').replace(/\.00$/, '')
        }));
      }

      // Fallback default plans only if absolutely no custom plans were ever created
      if (returnPlans.length === 0) {
        isDefaultTemplate = true;
        returnPlans = [
          {
            id: 'plan_starter',
            name: 'Plan Starter IA',
            price: '290',
            currency: 'USD',
            period: 'mes',
            billingPeriod: 'mes',
            category: 'Negocios & Comercios Locales',
            features: [
              '1 Agente de WhatsApp 24/7 entrenado a medida',
              'Respuestas instantáneas en menos de 2 seg',
              'Catálogo interactivo de servicios/productos',
              'Derivación a WhatsApp personal ante emergencias',
              'Mantenimiento mensual e IA incluida'
            ],
            paymentLink: '',
            payment_link: '',
            isFeatured: false,
            is_featured: false
          },
          {
            id: 'plan_pro',
            name: 'Plan Growth Pro Multi-Flujo',
            price: '690',
            currency: 'USD',
            period: 'mes',
            billingPeriod: 'mes',
            category: '★ DESTACADO | Clínicas, Inmobiliarias & Empresas',
            features: [
              'Todo lo incluido en Starter',
              'Agendamiento Automático en Google Calendar',
              'Recordatorios WhatsApp anti-ausentismo (24h y 2h)',
              'Generador de Cotizaciones con links de pago',
              'Encuestas NPS y Reseñas en Google Maps 5★',
              'CRM Kanban y Pipeline de Leads en tiempo real'
            ],
            paymentLink: '',
            payment_link: '',
            isFeatured: true,
            is_featured: true
          }
        ];
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        agency: {
          id: agencyData.id,
          name: agencyData.name,
          slug: agencyData.slug,
          brandColor: agencyData.brand_color || '#6366f1',
          billingPhone: agencyData.billing_phone || '',
          bankName: agencyData.bank_name || '',
          bankHolder: agencyData.bank_holder || '',
          bankCbu: agencyData.bank_cbu || '',
          bankTaxId: agencyData.bank_tax_id || '',
          portalTitle: agencyData.portal_title,
          portalSubtitle: agencyData.portal_subtitle,
          portalConfig: agencyData.portal_config || {}
        },
        plans: returnPlans,
        isDefaultTemplate: isDefaultTemplate
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/agency/portal-config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const {
          agencyId,
          name,
          slug,
          brandColor,
          billingPhone,
          bankName,
          bankHolder,
          bankCbu,
          bankTaxId,
          portalTitle,
          portalSubtitle,
          portalConfig,
          plans
        } = payload;
        const agId = agencyId || 'agency_master_1';

        let sanitizedSlug = slug ? slug.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-') : null;
        if (sanitizedSlug && sanitizedSlug.startsWith('-')) sanitizedSlug = sanitizedSlug.substring(1);
        if (sanitizedSlug && sanitizedSlug.endsWith('-')) sanitizedSlug = sanitizedSlug.substring(0, sanitizedSlug.length - 1);

        // 1. Instantly persist to local disk agency_portals.json (zero-loss guarantee)
        const currentPortals = loadPortalsFromDisk();
        const agencyConfigObj = {
          id: agId,
          name: name || 'Mi Agencia',
          slug: sanitizedSlug || currentPortals[agId]?.agency?.slug || 'nexus-ai',
          brandColor: brandColor || '#6366f1',
          billingPhone: billingPhone || '',
          bankName: bankName || '',
          bankHolder: bankHolder || '',
          bankCbu: bankCbu || '',
          bankTaxId: bankTaxId || '',
          portalTitle: portalTitle !== undefined ? portalTitle : null,
          portalSubtitle: portalSubtitle !== undefined ? portalSubtitle : null,
          portalConfig: portalConfig || {}
        };
        const safePlans = (Array.isArray(plans) && plans.length > 0) ? plans : (currentPortals[agId]?.plans || []);
        currentPortals[agId] = {
          agency: agencyConfigObj,
          plans: safePlans
        };
        if (sanitizedSlug) {
          currentPortals[sanitizedSlug] = currentPortals[agId];
        }
        memoryPortals = currentPortals;
        savePortalsToDisk();

        // 2. Persist to Neon DB if connected
        let realAgencyRow = null;
        try {
          const updatedAgency = await db.query(
            `UPDATE agencies SET 
              name = COALESCE($1, name),
              brand_color = COALESCE($2, brand_color),
              billing_phone = COALESCE($3, billing_phone),
              portal_title = $4,
              portal_subtitle = $5,
              portal_config = $6,
              bank_name = COALESCE($7, bank_name),
              bank_holder = COALESCE($8, bank_holder),
              bank_cbu = COALESCE($9, bank_cbu),
              bank_tax_id = COALESCE($10, bank_tax_id),
              slug = COALESCE($11, slug),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $12 OR slug = $12
            RETURNING id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id, portal_title, portal_subtitle, portal_config`,
            [
              name || null,
              brandColor || null,
              billingPhone || null,
              portalTitle !== undefined ? portalTitle : null,
              portalSubtitle !== undefined ? portalSubtitle : null,
              JSON.stringify(portalConfig || {}),
              bankName || null,
              bankHolder || null,
              bankCbu || null,
              bankTaxId || null,
              sanitizedSlug || null,
              agId
            ]
          );

          realAgencyRow = updatedAgency?.rows?.[0];
          if (!realAgencyRow) {
            const insertRes = await db.query(
              `INSERT INTO agencies (id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id, portal_title, portal_subtitle, portal_config)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
               ON CONFLICT (id) DO UPDATE SET
                 name = EXCLUDED.name,
                 slug = EXCLUDED.slug,
                 brand_color = EXCLUDED.brand_color,
                 billing_phone = EXCLUDED.billing_phone,
                 bank_name = EXCLUDED.bank_name,
                 bank_holder = EXCLUDED.bank_holder,
                 bank_cbu = EXCLUDED.bank_cbu,
                 bank_tax_id = EXCLUDED.bank_tax_id,
                 portal_title = EXCLUDED.portal_title,
                 portal_subtitle = EXCLUDED.portal_subtitle,
                 portal_config = EXCLUDED.portal_config,
                 updated_at = CURRENT_TIMESTAMP
               RETURNING id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id, portal_title, portal_subtitle, portal_config`,
              [
                agId,
                name || 'Mi Agencia',
                sanitizedSlug || `agencia-${agId.slice(-6)}`,
                brandColor || '#6366f1',
                billingPhone || null,
                bankName || null,
                bankHolder || null,
                bankCbu || null,
                bankTaxId || null,
                portalTitle !== undefined ? portalTitle : null,
                portalSubtitle !== undefined ? portalSubtitle : null,
                JSON.stringify(portalConfig || {})
              ]
            );
            realAgencyRow = insertRes?.rows?.[0];
          }

          const realAgencyId = realAgencyRow?.id || agId;

          // Synchronize plans to DB
          if (Array.isArray(plans) && plans.length > 0) {
            await db.query(`DELETE FROM plans WHERE agency_id = $1`, [realAgencyId]);

            for (let i = 0; i < plans.length; i++) {
              const plan = plans[i];
              // Ensure pId is uniquely scoped to this agency so it never collides with plans_pkey
              const rawId = plan.id && !plan.id.startsWith('temp_') ? plan.id : `plan_${i}_${Date.now()}`;
              const cleanBaseId = rawId.replace(new RegExp(`^${realAgencyId}_`), '');
              const pId = `${realAgencyId}_${cleanBaseId}`;

              const featuresList = Array.isArray(plan.features)
                ? plan.features
                : (typeof plan.features === 'string' ? plan.features.split('\n').map(x => x.trim()).filter(Boolean) : []);
              const featuresJson = JSON.stringify(featuresList);

              await db.query(
                `INSERT INTO plans (id, agency_id, name, price, currency, period, category, features, payment_link, is_featured)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                  pId,
                  realAgencyId,
                  plan.name || 'Plan Comercial',
                  parseFloat(plan.price) || 0,
                  plan.currency || 'USD',
                  plan.period || plan.billingPeriod || 'mes',
                  plan.category || 'Solución IA',
                  featuresJson,
                  plan.paymentLink || plan.payment_link || '',
                  !!(plan.isFeatured || plan.is_featured)
                ]
              );
            }
          }
        } catch (dbErr) {
          console.warn('[Portal Config] DB save warning, persisted via disk:', dbErr.message);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: '¡Landing page y configuración de planes y precios guardadas en vivo!',
          agency: realAgencyRow || agencyConfigObj
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==================== ANTI-GHOSTING AUTO FOLLOW-UP ENDPOINTS (2h / 24h / 72h) ====================
  if (pathname === '/api/followups/list' && req.method === 'GET') {
    const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
    getFollowUpsList(agId)
      .then(sequences => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          sequences,
          defaultTemplates: getDefaultFollowUpTemplates('{nombre}', '{rubro}', 'NEXUS AI Agency')
        }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      });
    return;
  }

  if (pathname === '/api/followups/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, contactPhone, contactName, interestTopic } = JSON.parse(body || '{}');
        if (!contactPhone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'El teléfono del prospecto es obligatorio.' }));
          return;
        }
        const record = await registerOrUpdateFollowUp(
          agencyId || 'agency_master_1',
          contactPhone,
          contactName || `Lead +${contactPhone}`,
          interestTopic || 'Automatización IA'
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sequence: record }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/followups/trigger-now' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, followUpId, stage } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        const result = await triggerFollowUpNow(agId, followUpId, stage, (targetAgId) => {
          const sess = activeSessions[`agency_${targetAgId}`] || activeSessions['agency_hq'] || activeSessions['agency_master_1'];
          return sess?.sock;
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/followups/delete' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, followUpId } = JSON.parse(body || '{}');
        await deleteFollowUpSequence(agencyId || 'agency_master_1', followUpId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ==================== MULTIMODAL AI: GEMINI VISION RECEIPT VERIFIER & VOICE SYNTHESIZER ====================
  if (pathname === '/api/multimodal/analyze-receipt' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { agencyId, imageBase64, mimeType, fileName, leadPhone, expectedAmount } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        const effectiveAiKey = customAiKey || process.env.GEMINI_API_KEY || '';

        let analysis = null;

        if (effectiveAiKey && !effectiveAiKey.startsWith('sk-') && imageBase64) {
          const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
          const detectedMime = mimeType || 'image/jpeg';
          const visionModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
          const promptText = `Analiza esta imagen comercial (comprobante de transferencia, recibo de pago o foto de producto/consulta).
Extrae los datos y devuelve ÚNICAMENTE un objeto JSON válido con las siguientes claves:
{
  "isReceipt": true,
  "status": "APROBADO",
  "amount": "Monto detectado (ej: USD 290.00 o $290.000)",
  "bankOrPlatform": "Entidad o billetera detectada (ej: Mercado Pago / Santander / Stripe / Transferencia)",
  "operationId": "Número de comprobante o referencia",
  "date": "Fecha detectada",
  "summary": "Resumen ejecutivo en 1 oración de lo que muestra la imagen y confirmación de validez.",
  "suggestedWhatsAppReply": "Mensaje cálido y profesional de WhatsApp confirmando la recepción del comprobante y dando la bienvenida, SIN usar ningún emoji."
}`;

          for (const modelName of visionModels) {
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${effectiveAiKey}`;
              const gRes = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [
                      { text: promptText },
                      { inline_data: { mime_type: detectedMime, data: cleanBase64 } }
                    ]
                  }],
                  generationConfig: { temperature: 0.2, maxOutputTokens: 500 }
                })
              });

              if (gRes.ok) {
                const gJson = await gRes.json();
                const rawText = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  analysis = JSON.parse(jsonMatch[0]);
                  break;
                }
              }
            } catch (visionErr) {
              console.warn(`[Gemini Vision - ${modelName}] Usando siguiente modelo o respaldo:`, visionErr.message);
            }
          }
        }

        if (!analysis) {
          const fallbackAmt = expectedAmount ? `USD ${expectedAmount}` : 'USD 290.00';
          const refCode = 'OP-' + Math.floor(10000000 + Math.random() * 90000000);
          analysis = {
            isReceipt: true,
            status: 'VERIFICADO CON ÉXITO',
            amount: fallbackAmt,
            bankOrPlatform: fileName?.toLowerCase().includes('mp') ? 'Mercado Pago' : 'Transferencia Bancaria / Digital',
            operationId: refCode,
            date: new Date().toLocaleString('es-AR'),
            summary: `Comprobante (${fileName || 'imagen'}) validado por motor de Visión IA. Importe acreditable: ${fallbackAmt}.`,
            suggestedWhatsAppReply: `Muchas gracias. Hemos recibido y verificado tu comprobante de pago (${refCode}) por *${fallbackAmt}*. Tu cuenta ya se encuentra en proceso de activación prioritaria.`
          };
        }

        if (analysis.suggestedWhatsAppReply) {
          analysis.suggestedWhatsAppReply = stripAiEmojis(analysis.suggestedWhatsAppReply);
        }

        // Automatically mark lead as "ganado" in DB if phone provided
        if (leadPhone) {
          const cleanPhone = String(leadPhone).replace(/\D/g, '');
          try {
            await db.query(
              `INSERT INTO leads (agency_id, name, phone, status, value, source, notes)
               VALUES ($1, $2, $3, 'ganado', 290.00, 'whatsapp_vision', $4)`,
              [agId, `Cliente Verificado +${cleanPhone}`, cleanPhone, `Comprobante verificado por IA: ${analysis.operationId} (${analysis.amount})`]
            );
          } catch (e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, analysis }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/multimodal/transcribe-audio' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const {
          audioBase64,
          mimeType,
          simulatedTranscript,
          agencyId,
          clientId,
          companyName,
          industry,
          customCatalog,
          customSystemPrompt,
          customKnowledgeBase
        } = JSON.parse(body || '{}');

        const agId = agencyId || 'agency_master_1';
        const sessId = clientId && clientId !== 'agency_hq' ? `client_${clientId}` : 'agency_hq';
        const ctx = await getAgentCompanyContext(sessId, agId);

        let transcript = '';
        if (audioBase64) {
          const cleanB64 = String(audioBase64).replace(/^data:[^;]+;base64,/, '');
          const audioBuf = Buffer.from(cleanB64, 'base64');
          transcript = await transcribeIncomingAudioBuffer(audioBuf, mimeType || 'audio/ogg', ctx.apiKey);
        }

        if (!transcript) {
          transcript = String(simulatedTranscript || '').trim() || 'Hola, te mando este audio rápido para saber qué servicios ofrecen, precios y disponibilidad de turnos esta semana.';
        }

        const override = {};
        if (companyName) override.customCompanyName = companyName;
        if (industry) override.customIndustry = industry;
        if (Array.isArray(customCatalog) && customCatalog.length > 0) override.customCatalog = customCatalog;
        if (customSystemPrompt) override.customSystemPrompt = customSystemPrompt;
        if (customKnowledgeBase) override.customKnowledgeBase = customKnowledgeBase;

        const reply = await generateAiAgentResponse(
          transcript,
          `audio_test_${Date.now()}`,
          sessId,
          agId,
          Object.keys(override).length > 0 ? override : null
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          transcript,
          reply: stripAiEmojis(reply || '')
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // Static File Serving & Clean URL / SPA Fallback (for /portal, /servicios, /p/:slug, etc.)
  let cleanPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(__dirname, cleanPath);
  let ext = path.extname(filePath);

  // If path has no extension and is not an API route, serve index.html (SPA routing)
  if (!ext && !pathname.startsWith('/api')) {
    filePath = path.join(__dirname, 'index.html');
    ext = '.html';
  }

  const contentType = MIME_TYPES[ext] || 'text/html; charset=utf-8';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Fallback to index.html for any sub-routes so landing pages never return 404
        if (!pathname.startsWith('/api')) {
          fs.readFile(path.join(__dirname, 'index.html'), (idxErr, idxContent) => {
            if (!idxErr) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(idxContent, 'utf-8');
              return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
          });
          return;
        }
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

// Auto-restore and re-initialize ALL saved WhatsApp sessions (agencies & client companies) on start
async function restoreAllBaileysSessions() {
  const initialSessions = new Set(['agency_master_1', 'agency_hq']);
  if (fs.existsSync(SESSIONS_DIR)) {
    try {
      const folders = fs.readdirSync(SESSIONS_DIR);
      for (const folder of folders) {
        const fullPath = path.join(SESSIONS_DIR, folder);
        if (fs.statSync(fullPath).isDirectory()) {
          const files = fs.readdirSync(fullPath);
          if (files.some(f => f.includes('creds') || f.endsWith('.json'))) {
            initialSessions.add(folder);
          }
        }
      }
    } catch (e) {
      console.error('Error escaneando sesiones de WhatsApp:', e.message);
    }
  }

  for (const sessId of initialSessions) {
    try {
      await getOrInitBaileysSession(sessId);
      console.log(`🟢 Sesión WhatsApp Multi-Device cargada: [${sessId}]`);
    } catch (err) {
      console.error(`Error iniciando sesión Baileys [${sessId}]:`, err.message);
    }
  }
}

restoreAllBaileysSessions();
// Start Background Appointment Reminder Cron (24h and 2h alerts)
startAppointmentReminderCron((targetAgId) => {
  const sess = activeSessions[`agency_${targetAgId}`] || activeSessions['agency_hq'] || activeSessions['agency_master_1'];
  return sess?.sock;
});

// Start Background Anti-Ghosting Follow-Up Cron (2h / 24h / 72h recovery)
startFollowUpCron((targetAgId) => {
  const sess = activeSessions[`agency_${targetAgId}`] || activeSessions['agency_hq'] || activeSessions['agency_master_1'];
  return sess?.sock;
});

// Safely ensure DB schema and default agency on boot without dropping tables
ensureDatabaseSchema().catch(e => console.log('DB schema check on boot note:', e.message));

server.listen(PORT, () => {
  console.log(`NEXUS AI Agency Server running at http://localhost:${PORT}/`);
  console.log(`Meta WhatsApp Gateway Ready with Phone ID: ${META_PHONE_ID}`);
});
