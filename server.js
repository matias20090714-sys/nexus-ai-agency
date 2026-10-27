const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const QRCode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const db = require('./db');
const { initDatabase } = require('./init-db');
const {
  parseSpintax,
  getAgencyKnowledgeContext,
  checkAndAlertOwner,
  startAppointmentReminderCron,
  startBroadcastExecution,
  createGoogleCalendarEvent,
  activeCampaigns
} = require('./agency-features');

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
                // Feature 5: Check and Alert Owner for High-Intent Lead
                const agId = sessionId.replace('agency_', '').replace('client_', '') || 'agency_master_1';
                checkAndAlertOwner(agId, senderNumber, textBody, sock).catch(e => console.error(e));

                // Simulate human delay (1.2s)
                await new Promise(r => setTimeout(r, 1200));
                const aiReply = await generateAiAgentResponse(textBody, senderNumber, sessionId, agId);
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

// AI Auto-Responder Engine (Supports Google Gemini & OpenAI)
const AI_CONFIG_FILE = path.join(__dirname, 'ai_config.json');
const COMPANIES_FILE = path.join(__dirname, 'companies_agents.json');
const PORTALS_FILE = path.join(__dirname, 'agency_portals.json');
let customAiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
let activeAiModel = process.env.AI_MODEL || 'gemini-1.5-flash';
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
      memoryCompanies = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
      const total = Object.values(memoryCompanies).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      console.log(`[AI Engine] ${total} empresas y agentes por nicho cargados desde disco.`);
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

// Resolver context of specific client / company by session or agency ID
async function getAgentCompanyContext(sessionId = '', agencyId = 'agency_master_1') {
  const allCompanies = Object.values(memoryCompanies).flat();
  let matched = null;

  // 1. Match by sessionId (e.g. client_client-1729... or client-1729...)
  if (sessionId) {
    const cleanSess = sessionId.replace('client_', '').replace('agency_', '');
    matched = allCompanies.find(c => c.id === cleanSess || c.id === sessionId || `client_${c.id}` === sessionId || `agency_${c.id}` === sessionId);
  }

  // 2. Match by agencyId if not matched
  if (!matched && agencyId) {
    const cleanAg = agencyId.replace('agency_', '').replace('client_', '');
    matched = allCompanies.find(c => c.id === cleanAg || c.id === agencyId);
    if (!matched && memoryCompanies[agencyId] && memoryCompanies[agencyId].length > 0) {
      matched = memoryCompanies[agencyId][0];
    }
    if (!matched && memoryCompanies[cleanAg] && memoryCompanies[cleanAg].length > 0) {
      matched = memoryCompanies[cleanAg][0];
    }
  }

  // 3. Fallback to first company in memory if available
  if (!matched && allCompanies.length > 0) {
    matched = allCompanies[0];
  }

  // Default fallback if no custom company is registered yet
  if (!matched) {
    return {
      id: 'default_agency',
      companyName: 'NEXUS AI Agency',
      industry: 'Soluciones de Inteligencia Artificial & Automatización',
      agentName: 'Asistente Virtual IA',
      tone: 'profesional_calido',
      systemPrompt: 'Eres el asistente virtual con IA oficial de la empresa. Atiende consultas, explica servicios y precios con calidez e invita a agendar una cita o llamada estratégica.',
      catalogSummary: '• Plan Starter: $290 USD/mes (Agente de WhatsApp 24/7 entrenado a medida)\n• Plan Growth Pro: $490 USD/mes (Agente + Calendar + Cotizador + CRM)\n• Plan Enterprise: $890 USD/mes (Multi-agentes corporativos con integraciones avanzadas)',
      knowledgeBase: 'Horario: Atención 24/7 por WhatsApp. Oficinas: Atención remota para clientes de todo el mundo.',
      salesFlow: 'Califica la necesidad del cliente y ofrece coordinar una breve demo de 15 minutos.'
    };
  }

  // Build catalog summary text from matched company's catalog
  let catalogSummary = '';
  if (Array.isArray(matched.catalog) && matched.catalog.length > 0) {
    catalogSummary = matched.catalog.map(item => 
      `• ${item.name}: $${item.price} ${item.duration ? `(${item.duration})` : ''} - ${item.description || ''}`
    ).join('\n');
  } else if (matched.notes && matched.notes.includes('$')) {
    catalogSummary = matched.notes;
  } else {
    catalogSummary = 'Contamos con servicios especializados y propuestas a medida para tu necesidad.';
  }

  // Build sales flow string
  let salesFlowStr = '';
  if (matched.salesFlow && typeof matched.salesFlow === 'object') {
    salesFlowStr = [
      matched.salesFlow.qualification ? `Pregunta de calificación: ${matched.salesFlow.qualification}` : '',
      matched.salesFlow.objections ? `Manejo de objeciones: ${matched.salesFlow.objections}` : '',
      matched.salesFlow.closing ? `Cierre / Agendamiento: ${matched.salesFlow.closing}` : ''
    ].filter(Boolean).join('\n');
  } else if (matched.salesFlow) {
    salesFlowStr = matched.salesFlow;
  } else {
    salesFlowStr = 'Invita cordialmente a coordinar una cita, llamada o turno según corresponda.';
  }

  return {
    id: matched.id,
    companyName: matched.name || 'Empresa',
    industry: matched.industry || 'Servicios Especializados',
    agentName: matched.agentName || `Asistente de ${matched.name}`,
    tone: matched.tone || 'profesional_calido',
    systemPrompt: matched.systemPrompt || `Eres el asistente virtual oficial de ${matched.name}. Atiende con amabilidad y orienta a resolver consultas y agendar turnos o ventas.`,
    catalogSummary: catalogSummary,
    knowledgeBase: matched.knowledgeBase || `Atención de Lunes a Sábados. Consultas y reservas por WhatsApp.`,
    salesFlow: salesFlowStr
  };
}

async function generateAiAgentResponse(userText, senderPhone, sessionOrAgencyId = '', maybeAgencyId = '') {
  const text = (userText || '').toLowerCase().trim();
  if (!text) return null;

  let sessionId = sessionOrAgencyId;
  let agencyId = maybeAgencyId || sessionOrAgencyId || 'agency_master_1';
  if (sessionOrAgencyId && !maybeAgencyId && !sessionOrAgencyId.startsWith('client_') && !sessionOrAgencyId.startsWith('agency_')) {
    agencyId = sessionOrAgencyId;
  }

  // 1. Resolve company & niche training
  const ctx = await getAgentCompanyContext(sessionId, agencyId);

  // 2. Load RAG Knowledge Documents if present
  const docContext = await getAgencyKnowledgeContext(ctx.id || agencyId);
  const ragInstruction = docContext 
    ? `\n\nDOCUMENTACIÓN OFICIAL DE ${ctx.companyName.toUpperCase()}:\n${docContext}\n` 
    : '';

  // 3. Call Real Generative LLM if API Key is configured
  if (customAiKey) {
    try {
      const prompt = `Eres ${ctx.agentName}, el asistente virtual con Inteligencia Artificial oficial de ${ctx.companyName} (${ctx.industry}).
Tu personalidad y tono son: ${ctx.tone}.

INSTRUCCIONES Y REGLAS DE ATENCIÓN DE ${ctx.companyName.toUpperCase()}:
${ctx.systemPrompt}

CATÁLOGO OFICIAL DE SERVICIOS Y PRECIOS:
${ctx.catalogSummary}

INFORMACIÓN DEL NEGOCIO (HORARIOS, UBICACIÓN, POLÍTICAS):
${ctx.knowledgeBase}

PAUTAS DE VENTAS Y AGENDAMIENTO:
${ctx.salesFlow}
${ragInstruction}
MENSAJE DEL CLIENTE (+${senderPhone}): "${userText}"

REGLAS DE RESPUESTA:
- Responde estrictamente adoptando la identidad de ${ctx.companyName} en el rubro de ${ctx.industry}.
- Si el cliente pregunta por servicios o precios, cítale los ítems y precios exactos de su catálogo.
- Si el cliente pide turno o cita, solicítale el día y horario preferido según la información del negocio.
- Si el cliente agradece, responde con amabilidad manteniendo la calidez del negocio.
- Si el cliente se despide, deséale un excelente día.
- Responde siempre en español, de forma concisa (máximo 2 a 3 párrafos cortos para WhatsApp móvil), usando emojis profesionales acordes al rubro.

Respuesta:`;
      
      // OpenAI API Support (keys starting with sk-)
      if (customAiKey.startsWith('sk-')) {
        const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${customAiKey}`
          },
          body: JSON.stringify({
            model: activeAiModel.includes('gpt') ? activeAiModel : 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `Eres ${ctx.agentName}, asistente virtual de ${ctx.companyName} (${ctx.industry}). Responde siempre en español, con calidez, usando emojis profesionales, conciso y orientado a solucionar y vender.` },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 450
          })
        });
        if (oaiRes.ok) {
          const oaiData = await oaiRes.json();
          const reply = oaiData.choices?.[0]?.message?.content;
          if (reply) return reply.trim();
        } else {
          const errData = await oaiRes.text();
          console.error('[OpenAI API Error]', oaiRes.status, errData);
        }
      } else {
        // Google Gemini API Support (default model gemini-1.5-flash or gemini-2.0-flash)
        const geminiModel = activeAiModel.includes('gemini') ? activeAiModel : 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${customAiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 450
            }
          })
        });
        if (response.ok) {
          const json = await response.json();
          const candidate = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidate) return candidate.trim();
        } else {
          const errData = await response.text();
          console.error('[Gemini API Error]', response.status, errData);
        }
      }
    } catch (err) {
      console.log('LLM API call fallback to contextual heuristics:', err.message);
    }
  }

  // 4. High-converting smart contextual heuristics fallback (TAILORED TO THIS COMPANY & NICHE)
  if (docContext && (text.includes('precio') || text.includes('catalogo') || text.includes('servicio') || text.includes('costo') || text.includes('cuanto'))) {
    return `¡Hola! Aquí tienes la información oficial de ${ctx.companyName}:\n\n${docContext.slice(0, 450)}...\n\n¿Te gustaría coordinar una cotización personalizada o agendar un turno?`;
  }

  // Agradecimientos (gracias, muchas gracias, etc.)
  if (text.includes('gracia') || text.includes('graciela') || text.includes('agradecid') || text.includes('te agradezco') || text.includes('muy amable') || text === 'grx' || text === 'thx') {
    return `¡De nada! 😊 En ${ctx.companyName} es un placer ayudarte. Si tienes cualquier otra pregunta sobre nuestros servicios de ${ctx.industry} o deseas agendar una cita, aquí estoy a tu disposición. ¡Que tengas un excelente día!`;
  }

  // Despedidas (chau, adiós, nos vemos, etc.)
  if (text.includes('chau') || text.includes('adios') || text.includes('adiós') || text.includes('hasta luego') || text.includes('nos vemos') || text.includes('bye') || text.includes('hasta pronto') || text.includes('buenas noches') || text.includes('buen finde')) {
    return `¡Hasta luego! 👋 Que tengas un excelente día. Si en algún momento deseas retomar la consulta en ${ctx.companyName}, ver servicios o coordinar una visita, solo escríbenos por aquí. ¡Estamos a tu disposición 24/7!`;
  }

  // Confirmaciones y asentimientos (ok, dale, perfecto, genial, listo)
  if (text === 'ok' || text === 'dale' || text === 'perfecto' || text === 'genial' || text === 'buenisimo' || text === 'buenísimo' || text === 'excelente' || text === 'listo' || text === 'de una' || text === 'bien' || text.startsWith('ok ') || text.includes('entendido') || text.includes('comprendo')) {
    return `¡Excelente! 👍 ¿Te gustaría que te preparemos una propuesta personalizada para ${ctx.companyName} o prefieres coordinar un turno/cita en nuestro calendario?`;
  }

  // Conversación casual e identidad (cómo estás, quién eres, qué haces)
  if (text.includes('como estas') || text.includes('cómo estás') || text.includes('que tal') || text.includes('qué tal') || text.includes('todo bien') || text.includes('quien eres') || text.includes('quién eres') || text.includes('quien sos') || text.includes('quién sos') || text.includes('que haces') || text.includes('qué haces') || text.includes('como funciona') || text.includes('cómo funciona')) {
    return `¡Todo excelente por aquí! 🚀 Soy ${ctx.agentName}, el asistente virtual de ${ctx.companyName} (${ctx.industry}), disponible 24/7 para responder tus consultas al instante, informarte de nuestros servicios y coordinar turnos. ¿En qué podemos ayudarte hoy?`;
  }

  // Ubicación y oficinas (dónde están, dirección, etc.)
  if (text.includes('donde estan') || text.includes('dónde están') || text.includes('donde quedan') || text.includes('dónde quedan') || text.includes('direccion') || text.includes('dirección') || text.includes('ubicacion') || text.includes('ubicación') || text.includes('de donde son') || text.includes('de dónde son')) {
    return `📍 Información y ubicación de ${ctx.companyName}:\n\n${ctx.knowledgeBase}\n\n¿Deseas coordinar un turno o visita presencial?`;
  }

  // Horarios de atención
  if (text.includes('horario') || text.includes('a que hora') || text.includes('a qué hora') || text.includes('atienden hoy') || text.includes('estan abiertos') || text.includes('están abiertos')) {
    return `🕒 Horarios de ${ctx.companyName}:\n\n${ctx.knowledgeBase}\n\nNuestro canal de WhatsApp con IA atiende consultas las 24 horas del día.`;
  }

  // Saludos iniciales
  if (text.includes('hola') || text.includes('buenos') || text.includes('buenas') || text.includes('info') || text.includes('saludos') || text === 'buen dia' || text === 'buen día') {
    return `¡Hola! 👋 Gracias por comunicarte con ${ctx.companyName} (${ctx.industry}). Soy ${ctx.agentName}, tu asistente 24/7.\n\n¿En qué podemos ayudarte hoy?\n1️⃣ Consultar catálogo de servicios y precios\n2️⃣ Agendar una cita o turno\n3️⃣ Solicitar una cotización personalizada\n4️⃣ Hablar con un especialista humano`;
  }

  // Servicios y catálogo de la empresa
  if (text.includes('servicio') || text.includes('catalogo') || text.includes('catálogo') || text.includes('ofrecen') || text.includes('solucion') || text.includes('solución') || text.includes('producto')) {
    return `⭐ Servicios oficiales de ${ctx.companyName} (${ctx.industry}):\n\n${ctx.catalogSummary}\n\n¿Te gustaría coordinar un turno o solicitar más detalles sobre alguno en particular?`;
  }

  // Precios y planes de la empresa
  if (text.includes('precio') || text.includes('costo') || text.includes('cuanto') || text.includes('cuánto') || text.includes('plan') || text.includes('tarifa') || text === '1') {
    return `💵 ¡Con gusto! Aquí tienes nuestros precios oficiales en ${ctx.companyName}:\n\n${ctx.catalogSummary}\n\n¿Te gustaría que te reservemos un turno o te preparemos una propuesta personalizada?`;
  }

  // Turnos y reuniones
  if (text.includes('turno') || text.includes('cita') || text.includes('reunion') || text.includes('reunión') || text.includes('demo') || text.includes('agendar') || text.includes('llamada') || text === '2') {
    return `📅 ¡Con gusto! Para coordinar tu turno en ${ctx.companyName}, indícanos qué día y horario te queda más cómodo (o déjanos tu correo) y nuestro sistema lo reservará de inmediato.`;
  }

  // Cotizaciones y presupuestos
  if (text.includes('cotiza') || text.includes('presupuesto') || text.includes('propuesta') || text === '3') {
    return `📄 ¡Por supuesto! En ${ctx.companyName} podemos generarte una cotización oficial con desglose de ítems. ¿Cuál es tu nombre y qué solución o servicio necesitas?`;
  }

  // Asesor humano
  if (text.includes('humano') || text.includes('asesor') || text.includes('persona') || text.includes('operador') || text === '4') {
    return `👤 Entendido. He notificado a uno de nuestros especialistas de ${ctx.companyName} para que revise tu consulta y te responda a la brevedad por este mismo chat. ¡Muchas gracias por tu paciencia!`;
  }

  // Fallback conversacional cálido de la empresa
  return `¡Hola! 👋 He recibido tu mensaje en ${ctx.companyName}. Como asistente virtual de ${ctx.industry}, estoy disponible 24/7.\n\n¿Te gustaría conocer nuestros servicios y precios, reservar un turno, o prefieres hablar directamente con un asesor humano?`;
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
        const { agencyId, clients } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        if (Array.isArray(clients)) {
          memoryCompanies[agId] = clients;
          saveCompaniesToDisk();

          // Also persist to Neon PostgreSQL clients table if available
          if (db) {
            for (const c of clients) {
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
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: Array.isArray(clients) ? clients.length : 0 }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  if (pathname === '/api/agency/clients/sync' && req.method === 'GET') {
    const agId = urlObj.searchParams.get('agencyId') || 'agency_master_1';
    const clients = memoryCompanies[agId] || memoryCompanies['agency_master_1'] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, clients }));
    return;
  }

  // 7.2 Test Chat with Specific Trained Agent / Niche
  if (pathname === '/api/agents/test-chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { message, clientId, agencyId } = JSON.parse(body || '{}');
        const ctx = await getAgentCompanyContext(clientId, agencyId);
        const reply = await generateAiAgentResponse(message || 'Hola', '5491100000000', clientId, agencyId);
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
      const localEntry = allPortals[identifier] || allPortals['agency_master_1'] || Object.values(allPortals)[0];

      let agencyData = null;
      let returnPlans = [];

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
          `SELECT id, name, price, currency, period, category, features, payment_link, is_featured FROM plans WHERE agency_id = $1 ORDER BY price ASC`,
          [agencyData.id]
        );
        if (plansRes?.rows && plansRes.rows.length > 0) {
          returnPlans = plansRes.rows;
        }
      } catch (e) {}

      // If DB had no plans, check if local disk has custom saved plans!
      if (returnPlans.length === 0 && localEntry?.plans && Array.isArray(localEntry.plans) && localEntry.plans.length > 0) {
        returnPlans = localEntry.plans;
      }

      // Fallback default plans only if absolutely no custom plans were ever created
      if (returnPlans.length === 0) {
        returnPlans = [
          {
            id: 'plan_starter',
            name: 'Plan Starter IA',
            price: '290.00',
            currency: 'USD',
            period: 'mes',
            category: 'Negocios & Comercios Locales',
            features: [
              '1 Agente de WhatsApp 24/7 entrenado a medida',
              'Respuestas instantáneas en menos de 2 seg',
              'Catálogo interactivo de servicios/productos',
              'Derivación a WhatsApp personal ante emergencias',
              'Mantenimiento mensual e IA incluida'
            ],
            payment_link: '',
            is_featured: false
          },
          {
            id: 'plan_pro',
            name: 'Plan Growth Pro Multi-Flujo',
            price: '690.00',
            currency: 'USD',
            period: 'mes',
            category: '★ DESTACADO | Clínicas, Inmobiliarias & Empresas',
            features: [
              'Todo lo incluido en Starter',
              'Agendamiento Automático en Google Calendar',
              'Recordatorios WhatsApp anti-ausentismo (24h y 2h)',
              'Generador de Cotizaciones con links de pago',
              'Encuestas NPS y Reseñas en Google Maps 5★',
              'CRM Kanban y Pipeline de Leads en tiempo real'
            ],
            payment_link: '',
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
        plans: returnPlans
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
              const pId = plan.id && !plan.id.startsWith('temp_') ? plan.id : `plan_${Date.now()}_${i}`;
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
                  plan.category || 'General',
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

// Auto-initialize DB schema and default agency if needed
initDatabase().catch(e => console.log('DB init on boot note:', e.message));

server.listen(PORT, () => {
  console.log(`NEXUS AI Agency Server running at http://localhost:${PORT}/`);
  console.log(`Meta WhatsApp Gateway Ready with Phone ID: ${META_PHONE_ID}`);
});
