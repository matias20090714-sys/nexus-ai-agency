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

  // Default fallback if no custom company is registered yet (Uses customized agency portal data if available)
  if (!matched) {
    const portal = (agencyId && memoryPortals[agencyId]) || memoryPortals['agency_master_1'] || {};
    const agencyName = portal.agency?.name || 'NEXUS AI Agency';
    let plansSummary = '';
    if (Array.isArray(portal.plans) && portal.plans.length > 0) {
      plansSummary = portal.plans.map(p => 
        `• ${p.name}: $${p.price} ${p.currency || 'USD'}/${p.period || p.billingPeriod || 'mes'} (${(p.features || []).slice(0, 3).join(', ')})`
      ).join('\n');
    } else {
      plansSummary = '• Plan Starter: $290 USD/mes (Agente de WhatsApp 24/7 entrenado a medida)\n• Plan Growth Pro: $490 USD/mes (Agente + Calendar + Cotizador + CRM)\n• Plan Enterprise: $890 USD/mes (Multi-agentes corporativos con integraciones avanzadas)';
    }

    return {
      id: 'default_agency',
      companyName: agencyName,
      industry: 'Soluciones de Inteligencia Artificial & Automatización Comercial',
      agentName: `Asesor Comercial de ${agencyName}`,
      tone: 'profesional_calido_y_persuasivo',
      systemPrompt: `Eres el asesor y consultor comercial de ${agencyName}. Dialoga con empatía humana, explica los servicios con elocuencia, responde cualquier duda que te hagan y orienta la conversación hacia coordinar una breve llamada estratégica o contratar el servicio.`,
      catalogSummary: plansSummary,
      knowledgeBase: 'Horario: Atención 24/7 por WhatsApp. Modalidad: Servicios remotos llave en mano con soporte continuo para empresas de todo el mundo.',
      salesFlow: 'Califica la empresa y necesidad del cliente, responde todas sus dudas y coordina una demo de 15 minutos o activación del plan.'
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
    systemPrompt: matched.systemPrompt || `Eres el asesor y asistente comercial oficial de ${matched.name}. Atiende con amabilidad y calidez humana, resuelve cualquier duda y orienta a cerrar ventas o turnos.`,
    catalogSummary: catalogSummary,
    knowledgeBase: matched.knowledgeBase || `Atención de Lunes a Sábados. Consultas y reservas por WhatsApp.`,
    salesFlow: salesFlowStr
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
function generateContextualSalesReply(lowerText, rawText, history, ctx, docContext) {
  const lastBotMsg = history.filter(h => h.role === 'assistant').slice(-1)[0]?.text || '';
  const lastUserMsg = history.filter(h => h.role === 'user').slice(-2, -1)[0]?.text || '';
  const hadPriceDiscussion = history.some(h => (h.text || '').toLowerCase().includes('precio') || (h.text || '').toLowerCase().includes('$') || (h.text || '').toLowerCase().includes('plan'));

  // 1. Si hay documentación RAG oficial y pregunta por algún dato del documento
  if (docContext && (lowerText.includes('precio') || lowerText.includes('catalogo') || lowerText.includes('catálogo') || lowerText.includes('servicio') || lowerText.includes('costo') || lowerText.includes('cuanto') || lowerText.includes('cuánto'))) {
    return `¡Con gusto! Aquí tienes la información detallada de ${ctx.companyName}:\n\n${docContext.slice(0, 480)}...\n\n¿Te gustaría coordinar una cotización a medida o prefieres agendar un turno para avanzar?`;
  }

  // 2. Intención de compra / Cierre / Acuerdo (me interesa, dale, quiero contratar, cómo pago, lo quiero)
  const isAgreementOrClose = lowerText.includes('me interesa') || lowerText.includes('quiero contratar') || lowerText.includes('como contrato') || lowerText.includes('cómo contrato') ||
    lowerText.includes('como pago') || lowerText.includes('cómo pago') || lowerText.includes('donde pago') || lowerText.includes('dónde pago') || lowerText.includes('donde transfiero') ||
    lowerText.includes('dónde transfiero') || lowerText.includes('empecemos') || lowerText.includes('lo quiero') || lowerText.includes('de una') || lowerText.includes('vamos con') ||
    lowerText.includes('acepto') || lowerText === 'dale' || lowerText.startsWith('dale ') || lowerText === 'si' || lowerText === 'sí' || lowerText === 'ok dale' || lowerText === 'listo dale';

  if (isAgreementOrClose) {
    return `¡Excelente decisión! 🚀 Nos entusiasma muchísimo trabajar contigo y darte la mejor experiencia en ${ctx.companyName}.\n\nPara dejar todo confirmado y avanzar de inmediato: ¿Prefieres que te pase por aquí los datos directos de activación / pago, o te queda más cómodo coordinar una breve llamada de 10 minutos para conocernos y repasar los detalles finales?`;
  }

  // 3. Manejo de objeción de precio (es caro, no llego, rebaja, descuento, presupuesto)
  const isPriceObjection = lowerText.includes('caro') || lowerText.includes('cara') || lowerText.includes('no tengo plata') || lowerText.includes('no tengo dinero') ||
    lowerText.includes('no llego') || lowerText.includes('descuento') || lowerText.includes('rebaja') || lowerText.includes('muy costoso') || lowerText.includes('fuera de presupuesto') ||
    lowerText.includes('algo mas barato') || lowerText.includes('algo más barato');

  if (isPriceObjection) {
    return `Te entiendo perfectamente, cuidar la inversión es una prioridad inteligente. En ${ctx.companyName} nuestros valores están pensados para que el retorno y la tranquilidad que recibes superen con creces lo abonado, sin sorpresas ni costos ocultos.\n\nAdemás, podemos ver facilidades o planes acordes a tu etapa actual. Cuéntame, ¿cuál de nuestras soluciones es la que más necesitas resolver hoy para ver cómo podemos adaptarla a ti?`;
  }

  // 4. Indecisión / Pensarlo (lo voy a pensar, déjame ver, después te aviso, tengo que consultarlo)
  const isHesitation = lowerText.includes('lo voy a pensar') || lowerText.includes('lo tengo que pensar') || lowerText.includes('dejame ver') || lowerText.includes('déjame ver') ||
    lowerText.includes('despues te aviso') || lowerText.includes('después te aviso') || lowerText.includes('despues te escribo') || lowerText.includes('después te escribo') ||
    lowerText.includes('tengo que hablar') || lowerText.includes('tengo que consultar') || lowerText.includes('con mi socio') || lowerText.includes('con mi pareja') || lowerText.includes('con mi esposa');

  if (isHesitation) {
    return `¡Totalmente comprensible! Es una decisión clave y es fundamental que la tomes con total seguridad. Para que tengas toda la información sobre la mesa: ¿Hay alguna duda puntual sobre la implementación o los resultados que te gustaría que aclaremos?\n\nSi te parece bien, puedo guardarte la disponibilidad o propuesta de esta semana sin ningún compromiso para que no pierdas el cupo mientras lo evalúas. ¿Qué opinas?`;
  }

  // 5. Confianza y Garantías (es seguro, tienen garantía, cómo sé que funciona, por qué confiar)
  const isTrustQuestion = lowerText.includes('es seguro') || lowerText.includes('garantia') || lowerText.includes('garantía') || lowerText.includes('confiable') ||
    lowerText.includes('como se que funciona') || lowerText.includes('cómo sé que funciona') || lowerText.includes('por que confiar') || lowerText.includes('por qué confiar') ||
    lowerText.includes('estafa') || lowerText.includes('referencias');

  if (isTrustQuestion) {
    return `Es una consulta sumamente válida y nos alegra que la hagas. En ${ctx.companyName} la transparencia y el compromiso con cada cliente son la base de todo: brindamos acompañamiento paso a paso, comunicación constante y total respaldo en cada servicio.\n\n¿Te gustaría coordinar una breve llamada o demo de 10 minutos para conocernos en vivo, ver casos prácticos y despejar cualquier duda antes de avanzar?`;
  }

  // 6. Precios y Catálogo oficial
  if (lowerText.includes('precio') || lowerText.includes('precios') || lowerText.includes('costo') || lowerText.includes('costos') || lowerText.includes('cuanto') || lowerText.includes('cuánto') || lowerText.includes('tarifa') || lowerText.includes('tarifas') || lowerText.includes('planes') || lowerText.includes('cotiza') || lowerText.includes('presupuesto')) {
    return `¡Con gusto! Aquí tienes nuestros servicios y precios oficiales en ${ctx.companyName} (${ctx.industry}):\n\n${ctx.catalogSummary}\n\n¿Cuál de estas alternativas se ajusta mejor a lo que estás buscando hoy?`;
  }

  // 7. Agendamiento de Turnos o Citas
  if (lowerText.includes('turno') || lowerText.includes('turnos') || lowerText.includes('cita') || lowerText.includes('citas') || lowerText.includes('agendar') || lowerText.includes('reunion') || lowerText.includes('reunión') || lowerText.includes('llamada') || lowerText.includes('reserva') || lowerText.includes('reservar') || lowerText.includes('disponibilidad')) {
    return `📅 ¡Por supuesto! Para coordinar tu cita en ${ctx.companyName}, indícanos por favor qué día te queda más cómodo (de lunes a sábados) y si prefieres un horario por la mañana o por la tarde. ¿Cuál te va mejor?`;
  }

  // 8. Servicios y qué hacen
  if (lowerText.includes('servicio') || lowerText.includes('servicios') || lowerText.includes('ofrecen') || lowerText.includes('que hacen') || lowerText.includes('qué hacen') || lowerText.includes('como funciona') || lowerText.includes('cómo funciona')) {
    return `⭐ En ${ctx.companyName} somos especialistas en ${ctx.industry}. Brindamos soluciones orientadas a darte los mejores resultados con atención personalizada:\n\n${ctx.catalogSummary}\n\n¿Te gustaría que te asesoremos sobre cómo resolver tu caso particular o deseas conocer más sobre alguno de nuestros planes?`;
  }

  // 9. Ubicación y Oficinas
  if (lowerText.includes('donde estan') || lowerText.includes('dónde están') || lowerText.includes('donde quedan') || lowerText.includes('dónde quedan') || lowerText.includes('direccion') || lowerText.includes('dirección') || lowerText.includes('ubicacion') || lowerText.includes('ubicación') || lowerText.includes('como llego') || lowerText.includes('cómo llego')) {
    return `📍 Información y ubicación de ${ctx.companyName}:\n\n${ctx.knowledgeBase}\n\n¿Te gustaría coordinar una visita presencial o prefieres que gestionemos todo directamente por WhatsApp?`;
  }

  // 10. Horarios de atención
  if (lowerText.includes('horario') || lowerText.includes('horarios') || lowerText.includes('a que hora') || lowerText.includes('a qué hora') || lowerText.includes('atienden hoy') || lowerText.includes('estan abiertos') || lowerText.includes('están abiertos')) {
    return `🕒 Horarios de atención de ${ctx.companyName}:\n\n${ctx.knowledgeBase}\n\nRecuerda que por este chat de WhatsApp te atendemos las 24 horas. ¿En qué podemos ayudarte en este momento?`;
  }

  // 11. Solicitud de asesor humano
  if (lowerText.includes('humano') || lowerText.includes('asesor') || lowerText.includes('persona') || lowerText.includes('operador') || lowerText.includes('alguien real')) {
    return `👤 ¡Por supuesto! Ya he notificado a nuestro equipo en ${ctx.companyName} para que un asesor especializado revise tu consulta y tome contacto contigo a la brevedad por este mismo chat. Mientras tanto, ¿deseas dejarme tu consulta detallada para ir adelantando?`;
  }

  // 12. Agradecimientos
  if (lowerText.includes('gracia') || lowerText.includes('agradecid') || lowerText.includes('te agradezco') || lowerText.includes('muy amable') || lowerText === 'grx' || lowerText === 'thx') {
    return `¡Al contrario, un verdadero placer! 😊 En ${ctx.companyName} estamos siempre a tu disposición para ayudarte. Si te gustaría que reservemos tu lugar o avancemos con tu propuesta, solo avísame y lo dejamos listo. ¡Que tengas un excelente día!`;
  }

  // 13. Despedidas
  if (lowerText.includes('chau') || lowerText.includes('adios') || lowerText.includes('adiós') || lowerText.includes('hasta luego') || lowerText.includes('nos vemos') || lowerText.includes('bye') || lowerText.includes('buenas noches') || lowerText.includes('buen finde')) {
    return `¡Hasta luego! 👋 Ha sido un placer hablar contigo. En ${ctx.companyName} quedamos a tu completa disposición para cuando desees retomar. ¡Que tengas un gran día!`;
  }

  // 14. Confirmaciones cortas (ok, genial, perfecto, entiendo)
  if (lowerText === 'ok' || lowerText === 'genial' || lowerText === 'perfecto' || lowerText === 'buenisimo' || lowerText === 'buenísimo' || lowerText === 'excelente' || lowerText === 'entendido' || lowerText === 'comprendo' || lowerText === 'bien') {
    if (hadPriceDiscussion) {
      return `¡Genial! 👍 Dado que estuvimos viendo nuestros planes de ${ctx.companyName}, ¿te gustaría que te reservemos tu cupo hoy mismo o prefieres que coordinemos una breve llamada para afinar detalles?`;
    }
    return `¡Excelente! 👍 En ${ctx.companyName} estamos listos para ayudarte. ¿Deseas que coordinemos una fecha para tu servicio o tienes alguna otra pregunta que quieras hacernos?`;
  }

  // 15. Saludos iniciales
  if (lowerText.includes('hola') || lowerText.includes('buen dia') || lowerText.includes('buen día') || lowerText.includes('buenas tardes') || lowerText.includes('buenas noches') || lowerText.includes('buenas') || lowerText.includes('que tal') || lowerText.includes('qué tal')) {
    return `¡Hola! 👋 Qué gusto saludarte. Te doy una cálida bienvenida a ${ctx.companyName} (${ctx.industry}). Mi nombre es ${ctx.agentName}.\n\nCuéntame, ¿qué consulta tienes o qué solución estás buscando para tu negocio o caso en este momento?`;
  }

  // 16. Respuesta universal inteligente y consultiva para CUALQUIER OTRA PREGUNTA ("CUALQUIER COSA")
  return `¡Excelente punto! Es una muy buena consulta. En ${ctx.companyName} nos tomamos el tiempo de escuchar cada detalle para darte la solución exacta en el rubro de ${ctx.industry}.\n\nRespecto a lo que mencionas, nuestro enfoque siempre es garantizarte máxima calidad, agilidad y resultados tangibles. Cuéntame un poco más sobre lo que necesitas o si te gustaría que veamos cuál de nuestros servicios se adapta mejor a ti para ayudarte a conseguirlo. ¿Qué opinas?`;
}

// ==================== GENERATE AI AGENT RESPONSE ====================
async function generateAiAgentResponse(userText, senderPhone, sessionOrAgencyId = '', maybeAgencyId = '') {
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

  // 2. Load RAG Knowledge Documents if present
  const docContext = await getAgencyKnowledgeContext(ctx.id || agencyId);
  const ragInstruction = docContext 
    ? `\n\nDOCUMENTACIÓN OFICIAL Y EXCLUSIVA DE ${ctx.companyName.toUpperCase()}:\n${docContext}\n` 
    : '';

  // 3. Multi-turn conversation history for this sender / session
  const convKey = getConvKey(agencyId, senderPhone);
  const history = getConversationHistory(convKey);

  // 4. Construct Elite Consultative Human Sales Prompt
  const systemPrompt = `Eres ${ctx.agentName}, un asesor y ejecutivo comercial humano de élite que representa oficialmente a "${ctx.companyName}" (${ctx.industry}).
Tu personalidad y tono son: ${ctx.tone}.

MISIÓN PRINCIPAL:
Eres un profesional de ventas y atención al cliente de primer nivel: empático, elocuente, sumamente persuasivo, educado y resolutivo. Tu labor es dialogar con fluidez humana auténtica, responder con brillantez y claridad a CUALQUIER pregunta o duda que te planteen, manejar con maestría cualquier objeción y guiar con sutileza y firmeza hacia el CIERRE DE VENTA o AGENDAMIENTO del servicio.

INFORMACIÓN OFICIAL DEL NEGOCIO ("${ctx.companyName.toUpperCase()}"):
- Rubro / Industria: ${ctx.industry}
- Pautas del negocio: ${ctx.systemPrompt}
- Catálogo Oficial de Servicios y Precios:
${ctx.catalogSummary}
- Información Operativa (Horarios, Ubicación, Políticas):
${ctx.knowledgeBase}
- Flujo Comercial y Cierre:
${ctx.salesFlow}
${ragInstruction}

REGLAS DE ORO DE CONVERSACIÓN Y CIERRE (OBLIGATORIAS):
1. HUMANIDAD TOTAL (CERO MODISMO ROBÓTICO):
   - NUNCA digas que eres una inteligencia artificial, un bot o un modelo de lenguaje. Habla en primera persona con calidez ("Te cuento...", "En nuestro equipo...", "Te recomiendo...", "Te puedo coordinar...").
   - NUNCA uses listas numeradas robóticas ("1️⃣ Opción 1, 2️⃣ Opción 2") salvo que el cliente te pida explícitamente un listado de precios.
   - Responde en párrafos cortos y fluidos (1 a 3 párrafos cortos para WhatsApp móvil), en un español impecable, natural y cálido, con emojis profesionales acordes al rubro.

2. AUTORIZACIÓN PARA PENSAR Y RESPONDER CUALQUIER COSA ("CUALQUIER COSA"):
   - Tienes autorización irrestricta para pensar, razonar y responder CUALQUIER pregunta que te haga el cliente: consultas generales, aspectos técnicos, comparativas, situaciones cotidianas, curiosidades, temas complejos u opiniones.
   - Jamás respondas con evasivas, disculpas robóticas ni digas "no tengo esa información". Usa tu sabiduría, sentido común y criterio humano para responder con solvencia y simpatía, y luego conecta sutilmente tu respuesta con cómo ${ctx.companyName} le facilita la vida o resuelve su problema.

3. METODOLOGÍA CONSULTIVA DE VENTAS Y MANEJO DE OBJECIONES:
   - Valida y Empatiza: Haz que el cliente se sienta escuchado y comprendido ("Totalmente comprensible", "Es una excelente consulta", "Entiendo perfecto tu situación").
   - Vende Resultados y Transformación: Enfócate en el beneficio real y tranquilidad que obtiene el cliente, no solo en características frías.
   - Si dicen que el precio es elevado o dudan: Reencuadra el valor, el retorno de inversión y el costo de no solucionar su necesidad a tiempo.
   - Si dicen "lo voy a pensar": Valida su tiempo con empatía, pero ofrece un siguiente paso de bajísimo compromiso (ej: reservar un turno o propuesta tentativa sin compromiso para que no pierdan la disponibilidad de esta semana).
   - Siempre cierra con una pregunta (Call To Action): NUNCA termines una respuesta en silencio o punto muerto. Concluye cada intervención con una pregunta amable de cierre o una alternativa concreta (ej: "¿Te queda más cómodo por la mañana o por la tarde?", "¿Te parece que te reservemos el lugar hoy mismo?").`;

  // 5. Try Generative LLM with Multi-Turn Memory (Gemini / OpenAI)
  let generatedReply = null;
  if (customAiKey) {
    try {
      // 5.A OpenAI API
      if (customAiKey.startsWith('sk-')) {
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
            'Authorization': `Bearer ${customAiKey}`
          },
          body: JSON.stringify({
            model: activeAiModel.includes('gpt') ? activeAiModel : 'gpt-4o-mini',
            messages: oaiMessages,
            temperature: 0.75,
            max_tokens: 500
          })
        });

        if (oaiRes.ok) {
          const oaiData = await oaiRes.json();
          generatedReply = oaiData.choices?.[0]?.message?.content;
        } else {
          console.error('[OpenAI API Error]', oaiRes.status, await oaiRes.text());
        }
      } else {
        // 5.B Google Gemini API with Multi-Turn
        const geminiModel = activeAiModel.includes('gemini') ? activeAiModel : 'gemini-1.5-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${customAiKey}`;
        const formattedContents = buildGeminiContents(history, userText);

        let gRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: formattedContents,
            system_instruction: {
              parts: [{ text: systemPrompt }]
            },
            generationConfig: {
              temperature: 0.75,
              maxOutputTokens: 500
            }
          })
        });

        if (gRes.ok) {
          const json = await gRes.json();
          generatedReply = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
          // Retry without system_instruction if unsupported on specific model
          const fallbackContents = JSON.parse(JSON.stringify(formattedContents));
          fallbackContents[0].parts[0].text = `[INSTRUCCIONES OFICIALES]\n${systemPrompt}\n\n[MENSAJE DEL CLIENTE]\n${fallbackContents[0].parts[0].text}`;
          const retryRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: fallbackContents,
              generationConfig: {
                temperature: 0.75,
                maxOutputTokens: 500
              }
            })
          });
          if (retryRes.ok) {
            const json = await retryRes.json();
            generatedReply = json?.candidates?.[0]?.content?.parts?.[0]?.text;
          } else {
            console.error('[Gemini API Error]', retryRes.status, await retryRes.text());
          }
        }
      }
    } catch (llmErr) {
      console.warn('[LLM Call Note] Fallback to conversational sales heuristics:', llmErr.message);
    }
  }

  // If LLM returned a valid response, record history and return
  if (generatedReply && generatedReply.trim()) {
    const finalReply = generatedReply.trim();
    appendToConversationHistory(convKey, 'user', userText);
    appendToConversationHistory(convKey, 'assistant', finalReply);
    return finalReply;
  }

  // 6. High-Converting Consultative Sales Heuristics Engine (Understands Multi-Turn Context & Human Intent)
  const reply = generateContextualSalesReply(lowerText, userText, history, ctx, docContext);
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
        const cleanClients = (Array.isArray(clients) ? clients : []).filter(c => c && c.id !== 'client_dental_1' && c.id !== 'client_resto_1' && !c.name?.includes('San Lucas') && !c.name?.includes('Bistro Gourmet'));

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
        const { message, clientId, agencyId, chatSessionId, reset } = JSON.parse(body || '{}');
        const agId = agencyId || 'agency_master_1';
        const sessionKey = chatSessionId || `sim_${clientId || 'hq'}`;

        if (reset) {
          clearConversationHistory(getConvKey(agId, sessionKey));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, reset: true, message: 'Historial de simulación reiniciado con éxito.' }));
          return;
        }

        const ctx = await getAgentCompanyContext(clientId, agId);
        const reply = await generateAiAgentResponse(message || 'Hola', sessionKey, clientId, agId);
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
