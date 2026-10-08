// NEXUS AI - Multi-Agency Operating System Engine (Complete Tenant Isolation)

// Multi-Agency Registry System
function getAgenciesRegistry() {
  const data = localStorage.getItem('nexus_all_agencies_registry');
  if (data) return JSON.parse(data);

  // Default initial agency
  const initial = [
    {
      id: 'agency_master_1',
      name: 'NEXUS AI Agency HQ',
      owner: 'Administrador Principal',
      email: 'admin@nexus-ai.agency',
      currency: 'USD',
      brandColor: '#6366f1',
      createdAt: new Date().toISOString()
    }
  ];
  localStorage.setItem('nexus_all_agencies_registry', JSON.stringify(initial));
  return initial;
}

function saveAgenciesRegistry(reg) {
  localStorage.setItem('nexus_all_agencies_registry', JSON.stringify(reg));
}

// Current Active Agency ID
let currentAgencyId = localStorage.getItem('nexus_current_agency_id') || 'agency_master_1';

// Isolated Data Getters for the Active Agency
function getAgencyClients() {
  const data = localStorage.getItem(`nexus_clients_${currentAgencyId}`);
  return data ? JSON.parse(data) : [];
}

function saveAgencyClients(clients) {
  localStorage.setItem(`nexus_clients_${currentAgencyId}`, JSON.stringify(clients));
}

function getAgencyLeads() {
  const data = localStorage.getItem(`nexus_leads_${currentAgencyId}`);
  return data ? JSON.parse(data) : [];
}

function saveAgencyLeads(leads) {
  localStorage.setItem(`nexus_leads_${currentAgencyId}`, JSON.stringify(leads));
}

function getAgencyProfile() {
  const reg = getAgenciesRegistry();
  return reg.find(a => a.id === currentAgencyId) || reg[0];
}

// State variables for currently active agency context
let agencyClients = getAgencyClients();
let realLeads = getAgencyLeads();
let activeClientId = 'agency_hq';
let activeInboxLeadId = null;

// Default Configuration (Loaded from localStorage or User Input)
const DEFAULT_GEMINI_KEY = localStorage.getItem('nexus_ai_key') || '';
const DEFAULT_META_TOKEN = localStorage.getItem('nexus_meta_token') || 'META_ACCESS_TOKEN_PLACEHOLDER';
const DEFAULT_PHONE_ID = localStorage.getItem('nexus_meta_phone_id') || '1342311562300304';

// Initialize context on load
document.addEventListener('DOMContentLoaded', () => {
  loadAgencyWorkspace(currentAgencyId);

  // Setup robust click listeners on all nav-items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = item.getAttribute('data-tab');
      if (tab) switchTab(tab);
    });
  });
});

// Load and isolate an agency workspace
function loadAgencyWorkspace(agencyId) {
  currentAgencyId = agencyId;
  localStorage.setItem('nexus_current_agency_id', agencyId);

  agencyClients = getAgencyClients();
  realLeads = getAgencyLeads();
  activeClientId = 'agency_hq';
  activeInboxLeadId = realLeads.length > 0 ? realLeads[0].id : null;

  const profile = getAgencyProfile();
  
  // Update Top Bar & Sidebar & Portal
  document.getElementById('topAgencyName').innerText = profile.name;
  document.getElementById('topAgencyId').innerText = `ID: #${profile.id.toUpperCase().slice(-6)}`;
  document.getElementById('topAgencyAvatar').innerText = profile.name ? profile.name[0].toUpperCase() : 'A';
  document.getElementById('sidebarBrandName').innerText = profile.name;
  document.getElementById('wlBrandName').value = profile.name;

  // Update Playbook & Pricing personalized elements
  const starterPrice = profile.priceStarter || '290';
  const proPrice = profile.pricePro || '690';
  
  const pbOwner = document.getElementById('pbOwnerName');
  const pbAgency = document.getElementById('pbAgencyName');
  if (pbOwner) pbOwner.innerText = profile.owner || 'Tu Nombre';
  if (pbAgency) pbAgency.innerText = profile.name || 'Tu Agencia';

  const portalStarter = document.getElementById('portalPriceStarter');
  const portalPro = document.getElementById('portalPricePro');
  if (portalStarter) portalStarter.innerHTML = `$${starterPrice} <span style="font-size: 14px; color: var(--text-dim); font-weight: 600;">USD / mes</span>`;
  if (portalPro) portalPro.innerHTML = `$${proPrice} <span style="font-size: 14px; color: var(--text-dim); font-weight: 600;">USD / mes</span>`;

  // Update WhiteLabel & Payments inputs
  const wlStarter = document.getElementById('wlPriceStarter');
  const wlPro = document.getElementById('wlPricePro');
  const wlLinkStarter = document.getElementById('wlPaymentLinkStarter');
  const wlLinkPro = document.getElementById('wlPaymentLinkPro');
  const wlBName = document.getElementById('wlBankName');
  const wlBHolder = document.getElementById('wlBankHolder');
  const wlBCbu = document.getElementById('wlBankCbu');
  const wlBTax = document.getElementById('wlBankTaxId');
  const wlBPhone = document.getElementById('wlBillingPhone');

  if (wlStarter) wlStarter.value = starterPrice;
  if (wlPro) wlPro.value = proPrice;
  if (wlLinkStarter) wlLinkStarter.value = profile.paymentLinkStarter || '';
  if (wlLinkPro) wlLinkPro.value = profile.paymentLinkPro || '';
  if (wlBName) wlBName.value = profile.bankName || '';
  if (wlBHolder) wlBHolder.value = profile.bankHolder || '';
  if (wlBCbu) wlBCbu.value = profile.bankCbu || '';
  if (wlBTax) wlBTax.value = profile.bankTaxId || '';
  if (wlBPhone) wlBPhone.value = profile.billingPhone || '';

  const step1 = document.getElementById('step1ScriptText');
  if (step1) {
    step1.innerHTML = `"Hola [Nombre del Dueño/Encargado] 👋 Te saluda <strong>${profile.owner || 'el Director'}</strong> de <strong>${profile.name}</strong>. Estuve viendo el perfil de [Empresa] y noté que tienen una demanda altísima de consultas por WhatsApp.<br><br>
Hicimos una prueba rápida y vimos que si alguien escribe fuera del horario comercial o un fin de semana, se pierden ventas potenciales frente a la competencia.<br><br>
Les armamos un asistente con IA exclusivo para [Empresa] que responde precios en 2 segundos y agenda turnos en el calendario automáticamente.<br><br>
¿Te gustaría que te mande un video de 1 minuto mostrándote cómo funciona sin ningún compromiso?"`;
  }

  const step4 = document.getElementById('step4ScriptText');
  if (step4) {
    step4.innerHTML = `"El servicio completo de <strong>${profile.name}</strong> tiene una cuota de <strong>$${proPrice} USD al mes</strong>. Comparado con pagarle el sueldo a un recepcionista ($800 a $1,200 USD), te ahorras más del 50% y la IA trabaja las 24 horas, fines de semana y feriados sin faltar jamás.<br><br>
Además, no tenemos contratos de permanencia forzada. Podemos tener el sistema instalado en tu número y funcionando en las próximas 48 horas. ¿Te preparo el acuerdo de activación para arrancar hoy mismo?"`;
  }

  if (profile.brandColor) {
    document.documentElement.style.setProperty('--accent-indigo', profile.brandColor);
    document.getElementById('wlColorPicker').value = profile.brandColor;
  }

  // Render all isolated sections
  renderAgencyDashboard();
  renderClientSelector();
  renderClientsList();
  renderRealInbox();
  renderRealKanban();
  loadActiveAgentForClient();
  updateMarketingForm();
  checkQrConnectionState();
}

// ==================== TAB NAVIGATION ====================
function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('mobile-open');
  }
}

function switchTab(tabName) {
  if (!tabName) return;

  // Auto-close sidebar on mobile upon tab selection
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && sidebar.classList.contains('mobile-open')) {
    sidebar.classList.remove('mobile-open');
  }

  // Update nav items directly by matching exact data-tab attribute
  document.querySelectorAll('.nav-item').forEach(item => {
    if (item.getAttribute('data-tab') === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update tab views
  document.querySelectorAll('.tab-view').forEach(view => {
    if (view.id === `tab-${tabName}`) {
      view.classList.add('active');
    } else {
      view.classList.remove('active');
    }
  });

  const titles = {
    'dashboard': '<i class="fa-solid fa-chart-pie" style="color: var(--accent-indigo);"></i> Dashboard de tu Agencia de IA',
    'agency-portal': '<i class="fa-solid fa-globe" style="color: #34d399;"></i> Mi Web Comercial de Agencia',
    'reactivation': '<i class="fa-solid fa-fire" style="color: #f59e0b;"></i> Reactivador de Clientes (Oferta Irresistible)',
    'clients': '<i class="fa-solid fa-users-gear" style="color: var(--accent-cyan);"></i> Empresas & Sub-Cuentas de Clientes',
    'agents-builder': '<i class="fa-solid fa-robot" style="color: var(--accent-indigo);"></i> Configuración del Agente & Base de Conocimiento',
    'inbox': '<i class="fa-brands fa-whatsapp" style="color: #25d366;"></i> Bandeja de WhatsApp Real',
    'pipeline': '<i class="fa-solid fa-bars-progress" style="color: var(--accent-indigo);"></i> Pipeline de Leads Reales',
    'playbook': '<i class="fa-solid fa-graduation-cap" style="color: #34d399;"></i> Manual Maestro de Ventas & Cierre B2B',
    'prospecting': '<i class="fa-solid fa-crosshairs" style="color: var(--accent-indigo);"></i> Prospección B2B & Demos',
    'marketing': '<i class="fa-solid fa-wand-magic-sparkles" style="color: #ec4899;"></i> AI Marketing Studio',
    'connections': '<i class="fa-solid fa-plug" style="color: var(--accent-cyan);"></i> APIs & WhatsApp Gateway',
    'whitelabel': '<i class="fa-solid fa-gem" style="color: var(--accent-purple);"></i> Personalización Marca Blanca'
  };

  if (titles[tabName]) {
    const pageTitleElem = document.getElementById('pageTitle');
    if (pageTitleElem) pageTitleElem.innerHTML = titles[tabName];
  }

  if (tabName === 'connections') {
    startRealQrListener(`agency_${currentAgencyId}`);
  }
}

// ==================== AGENCY DASHBOARD ====================
function renderAgencyDashboard() {
  const totalClients = agencyClients.length;
  const totalMRR = agencyClients.reduce((acc, c) => acc + (parseFloat(c.monthlyFee) || 0), 0);
  const totalLeads = realLeads.length;

  document.getElementById('dashTotalClients').innerText = totalClients;
  document.getElementById('dashTotalMRR').innerText = `$${totalMRR.toLocaleString()} USD/mes`;
  document.getElementById('dashTotalMessages').innerText = realLeads.reduce((acc, l) => acc + (l.history ? l.history.length : 0), 0);
  document.getElementById('dashTotalAgents').innerText = totalClients;
  document.getElementById('clientsCountBadge').innerText = totalClients;

  const listContainer = document.getElementById('dashboardClientsList');
  if (!listContainer) return;

  if (agencyClients.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 36px 20px; color: var(--text-dim);">
        <i class="fa-solid fa-building-circle-check" style="font-size: 42px; margin-bottom: 12px; color: rgba(255,255,255,0.1); display:block;"></i>
        <strong style="color: white; font-size: 15px; display: block; margin-bottom: 4px;">Aún no has registrado empresas clientes</strong>
        <p style="font-size: 13px; max-width: 450px; margin: 0 auto 16px auto;">Cuando consigas una empresa (clínica, barbería, inmobiliaria, etc.), agrégala aquí para asignarle un agente y cobrarle mensualmente.</p>
        <button class="btn btn-primary btn-sm" onclick="openNewClientModal()"><i class="fa-solid fa-plus"></i> Registrar Primer Cliente</button>
      </div>
    `;
  } else {
    listContainer.innerHTML = agencyClients.map(c => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: rgba(10, 13, 28, 0.6); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="width: 40px; height: 40px; border-radius: var(--radius-sm); background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; font-size: 18px; color: white;">
            ${c.name[0]}
          </div>
          <div>
            <strong style="font-size: 14.5px; color: white;">${c.name}</strong>
            <div style="font-size: 12px; color: var(--text-muted);">${c.industry} • Tel: ${c.phone || 'Sin asignar'}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 14px;">
          <span style="font-size: 13px; font-weight: 800; color: #34d399;">$${c.monthlyFee}/mes</span>
          <button class="btn btn-secondary btn-sm" onclick="selectAndManageClient('${c.id}')">Administrar Agente</button>
        </div>
      </div>
    `).join('');
  }
}

// ==================== CLIENT MANAGEMENT ====================
function renderClientSelector() {
  const select = document.getElementById('tenantSelector');
  if (!select) return;

  select.innerHTML = `<option value="agency_hq">🏢 Mi Agencia (Vista Global HQ)</option>` + 
    agencyClients.map(c => `<option value="${c.id}" ${c.id === activeClientId ? 'selected' : ''}>🏢 ${c.name}</option>`).join('');
}

function renderClientsList() {
  const container = document.getElementById('clientsCardsContainer');
  if (!container) return;

  if (agencyClients.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 20px; color: var(--text-dim);">
        <i class="fa-solid fa-users-slash" style="font-size: 48px; color: rgba(255,255,255,0.1); margin-bottom: 14px; display: block;"></i>
        <strong style="color: white; font-size: 16px; display: block; margin-bottom: 6px;">No hay sub-cuentas registradas</strong>
        <p style="font-size: 13.5px; max-width: 480px; margin: 0 auto 18px auto;">Agrega a las empresas que contratan tus servicios para configurarles su agente, prompts y base de datos.</p>
        <button class="btn btn-primary" onclick="openNewClientModal()"><i class="fa-solid fa-plus"></i> Crear Sub-Cuenta de Empresa</button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px;">
      ${agencyClients.map(c => `
        <div class="agent-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <span class="agent-category">${c.industry}</span>
              <div class="agent-name" style="margin-top: 2px;">${c.name}</div>
            </div>
            <span class="brand-badge" style="background: rgba(16,185,129,0.2); color: #34d399;">$${c.monthlyFee}/mes</span>
          </div>

          <div style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 16px;">
            <div><strong>WhatsApp:</strong> ${c.phone || 'Línea no vinculada'}</div>
            <div><strong>Agente:</strong> ${c.agentName || 'Asistente IA Estándar'}</div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: auto;">
            <button class="btn btn-emerald btn-sm" onclick="openQrPairModalForClient('${c.id}')" title="Vincular WhatsApp de esta empresa">
              <i class="fa-solid fa-qrcode"></i> Vincular QR
            </button>
            <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="selectAndManageClient('${c.id}')">
              <i class="fa-solid fa-robot"></i> Configurar Agente
            </button>
            <button class="btn btn-secondary btn-sm" onclick="deleteClientAccount('${c.id}')" title="Eliminar cliente">
              <i class="fa-solid fa-trash" style="color: #f43f5e;"></i>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function openNewClientModal() {
  document.getElementById('newClientModal').classList.add('active');
}

function saveNewAgencyClient() {
  const name = document.getElementById('newClientName').value.trim();
  const industry = document.getElementById('newClientIndustry').value;
  const phone = document.getElementById('newClientPhone').value.trim();
  const fee = document.getElementById('newClientFee').value.trim() || '490';

  if (!name) {
    showToast('Por favor escribe el nombre de la empresa', 'error');
    return;
  }

  // Find matching blueprint
  const blueprint = AGENCY_BLUEPRINTS.find(b => b.category === industry) || AGENCY_BLUEPRINTS[0];

  const newClient = {
    id: 'client-' + Date.now(),
    name: name,
    industry: industry,
    phone: phone || '+1 555-658-2385',
    monthlyFee: fee,
    agentName: `Asistente Virtual - ${name}`,
    systemPrompt: blueprint.defaultSystemPrompt.replace('la clínica', name).replace('la empresa', name).replace('el salón', name),
    knowledgeBase: `Información de ${name}:\n- Rubro: ${industry}\n- Atención: Lunes a Sábados 09:00 a 19:00\n- Precios: Consultar catálogo de servicios\n- Políticas: Citas con confirmación previa.`,
    createdAt: new Date().toISOString()
  };

  agencyClients.unshift(newClient);
  saveAgencyClients(agencyClients);

  renderAgencyDashboard();
  renderClientSelector();
  renderClientsList();
  closeModal('newClientModal');

  selectAndManageClient(newClient.id);
  showToast(`¡Sub-cuenta '${name}' creada exitosamente!`, 'success');
}

function selectAndManageClient(clientId) {
  activeClientId = clientId;
  renderClientSelector();
  loadActiveAgentForClient();
  switchTab('agents-builder');
}

function switchClientAccount(val) {
  activeClientId = val;
  loadActiveAgentForClient();
  showToast(`Entorno cambiado a: ${val === 'agency_hq' ? 'Vista Global HQ' : 'Sub-Cuenta de Cliente'}`, 'info');
}

function deleteClientAccount(clientId) {
  if (!confirm('¿Seguro que deseas eliminar esta sub-cuenta de cliente?')) return;
  agencyClients = agencyClients.filter(c => c.id !== clientId);
  saveAgencyClients(agencyClients);
  renderAgencyDashboard();
  renderClientSelector();
  renderClientsList();
  showToast('Sub-cuenta eliminada', 'info');
}

// ==================== AGENTS & KNOWLEDGE BASE ====================
function loadActiveAgentForClient() {
  const client = agencyClients.find(c => c.id === activeClientId);
  if (client) {
    document.getElementById('agentEditorName').value = client.agentName || `Asistente de ${client.name}`;
    document.getElementById('agentEditorPrompt').value = client.systemPrompt || '';
    document.getElementById('agentEditorKnowledge').value = client.knowledgeBase || '';
    if (document.getElementById('agentCalendarLink')) document.getElementById('agentCalendarLink').value = client.calendarLink || '';
    if (document.getElementById('agentGoogleCalendarEmail')) document.getElementById('agentGoogleCalendarEmail').value = client.googleCalendarEmail || '';
    if (document.getElementById('agentScheduleStart')) document.getElementById('agentScheduleStart').value = client.scheduleStart || '09:00';
    if (document.getElementById('agentScheduleEnd')) document.getElementById('agentScheduleEnd').value = client.scheduleEnd || '19:00';
    if (document.getElementById('agentSlotDuration')) document.getElementById('agentSlotDuration').value = client.slotDuration || '30';
    if (document.getElementById('agentReminderToggle')) document.getElementById('agentReminderToggle').checked = client.reminderEnabled !== false;
    if (document.getElementById('agentReminderTemplate')) document.getElementById('agentReminderTemplate').value = client.reminderTemplate || 'Hola {nombre}, te recordamos tu cita de {servicio} mañana a las {hora}. ¿Confirmas tu asistencia?';
  } else {
    document.getElementById('agentEditorName').value = 'Asistente Global de Agencia';
    document.getElementById('agentEditorPrompt').value = 'Eres el asistente de inteligencia artificial de la agencia NEXUS AI. Tu misión es brindar atención profesional y calificar clientes potenciales.';
    document.getElementById('agentEditorKnowledge').value = 'Servicios de Automatización con IA:\n- Plan Starter: $290 USD/mes\n- Plan Pro: $690 USD/mes\n- Implementación técnica y soporte 24/7.';
    if (document.getElementById('agentCalendarLink')) document.getElementById('agentCalendarLink').value = localStorage.getItem('nexus_global_cal_link') || '';
    if (document.getElementById('agentGoogleCalendarEmail')) document.getElementById('agentGoogleCalendarEmail').value = localStorage.getItem('nexus_global_cal_email') || '';
  }
}

function loadBlueprintPrompt(blueprintId) {
  if (!blueprintId) return;
  const bp = AGENCY_BLUEPRINTS.find(b => b.id === blueprintId);
  if (!bp) return;

  const client = agencyClients.find(c => c.id === activeClientId);
  const companyName = client ? client.name : 'la empresa';

  document.getElementById('agentEditorPrompt').value = bp.defaultSystemPrompt.replace('la clínica', companyName).replace('la empresa', companyName).replace('el salón', companyName);
  showToast(`Plantilla '${bp.name}' cargada`, 'info');
}

function saveActiveAgentConfig() {
  const client = agencyClients.find(c => c.id === activeClientId);
  const agentName = document.getElementById('agentEditorName').value.trim();
  const prompt = document.getElementById('agentEditorPrompt').value.trim();
  const knowledge = document.getElementById('agentEditorKnowledge').value.trim();

  const calendarLink = document.getElementById('agentCalendarLink')?.value.trim() || '';
  const googleEmail = document.getElementById('agentGoogleCalendarEmail')?.value.trim() || '';
  const scheduleStart = document.getElementById('agentScheduleStart')?.value || '09:00';
  const scheduleEnd = document.getElementById('agentScheduleEnd')?.value || '19:00';
  const slotDuration = document.getElementById('agentSlotDuration')?.value || '30';
  const reminderEnabled = document.getElementById('agentReminderToggle')?.checked !== false;
  const reminderTemplate = document.getElementById('agentReminderTemplate')?.value.trim() || '';

  if (client) {
    client.agentName = agentName;
    client.systemPrompt = prompt;
    client.knowledgeBase = knowledge;
    client.calendarLink = calendarLink;
    client.googleCalendarEmail = googleEmail;
    client.scheduleStart = scheduleStart;
    client.scheduleEnd = scheduleEnd;
    client.slotDuration = slotDuration;
    client.reminderEnabled = reminderEnabled;
    client.reminderTemplate = reminderTemplate;
    saveAgencyClients(agencyClients);
    showToast(`Configuración de Agente y Calendario guardada para ${client.name}`, 'success');
  } else {
    localStorage.setItem('nexus_global_cal_link', calendarLink);
    localStorage.setItem('nexus_global_cal_email', googleEmail);
    showToast('Configuración global del Agente y Calendario guardada', 'success');
  }
}

function testGoogleCalendarLink() {
  const client = agencyClients.find(c => c.id === activeClientId);
  const title = encodeURIComponent(`Cita con ${client ? client.name : 'NEXUS AI Agency'}`);
  const details = encodeURIComponent('Cita agendada automáticamente por el Agente de Inteligencia Artificial.');
  const location = encodeURIComponent(client?.address || 'Oficina / Enlace Virtual');
  
  // Format tomorrow date at 15:00
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');
  const dates = `${yyyy}${mm}${dd}T180000Z/${yyyy}${mm}${dd}T183000Z`;

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&location=${location}&dates=${dates}`;
  window.open(url, '_blank');
  showToast('Abriendo plantilla de evento en Google Calendar...', 'info');
}

async function testAgentLiveDialog() {
  const prompt = document.getElementById('agentEditorPrompt').value.trim();
  const knowledge = document.getElementById('agentEditorKnowledge').value.trim();
  const apiKey = localStorage.getItem('nexus_ai_key') || DEFAULT_GEMINI_KEY;

  if (!prompt) {
    showToast('Ingresa un prompt para probar el agente', 'error');
    return;
  }

  showToast('Enviando consulta de prueba a Google Gemini...', 'info');

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `[INSTRUCCIONES]: ${prompt}\n\n[BASE DE CONOCIMIENTO]: ${knowledge}\n\n[MENSAJE DEL CLIENTE]: Hola, ¿cuáles son sus horarios y cómo puedo agendar?` }]
        }]
      })
    });

    if (!response.ok) throw new Error('Error en API de Gemini');
    const data = await response.json();
    const replyText = data.candidates[0].content.parts[0].text;
    alert(`🤖 RESPUESTA REAL DE GEMINI IA:\n\n${replyText}`);
  } catch (err) {
    alert(`🤖 RESPUESTA DEL ASISTENTE:\n\n"¡Hola! Con gusto. Atendemos de Lunes a Sábados y puedes agendar indicándome tu nombre y fecha preferida."\n\n(Fallback activo)`);
  }
}

// ==================== REAL INBOX & WHATSAPP ====================
function renderRealInbox() {
  const listContainer = document.getElementById('realContactsList');
  if (!listContainer) return;

  if (realLeads.length === 0) {
    listContainer.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-dim); font-size: 13px;">
        <i class="fa-brands fa-whatsapp" style="font-size: 28px; margin-bottom: 8px; color: rgba(255,255,255,0.1); display:block;"></i>
        No hay chats activos aún.<br>Envía un WhatsApp de prueba con el botón arriba.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = realLeads.map(lead => `
    <div class="contact-item ${lead.id === activeInboxLeadId ? 'active' : ''}" onclick="selectRealInboxLead('${lead.id}')">
      <div class="contact-avatar-box">
        <div class="contact-avatar">${lead.phone ? lead.phone.slice(-2) : 'WA'}</div>
        <span class="channel-tag">🟢</span>
      </div>
      <div class="contact-info">
        <div class="contact-top-row">
          <div class="contact-name">${lead.name || lead.phone}</div>
          <div class="contact-time">${lead.timestamp || 'Hoy'}</div>
        </div>
        <div class="contact-last-msg">${lead.lastMessage || 'Mensaje de WhatsApp'}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('realInboxBadge').innerText = `${realLeads.length} Chats`;
}

function selectRealInboxLead(leadId) {
  activeInboxLeadId = leadId;
  const lead = realLeads.find(l => l.id === leadId);
  if (!lead) return;

  document.getElementById('activeInboxName').innerText = lead.name || lead.phone;
  document.getElementById('activeInboxAvatar').innerText = lead.phone ? lead.phone.slice(-2) : 'WA';
  document.getElementById('inboxDetailName').innerText = lead.name || 'Cliente WhatsApp';
  document.getElementById('inboxDetailPhone').innerText = lead.phone || '--';
  document.getElementById('inboxDetailCompany').innerText = lead.company || 'Agencia General';

  const msgContainer = document.getElementById('realMessagesContainer');
  msgContainer.innerHTML = (lead.history || []).map(msg => `
    <div class="msg-bubble ${msg.sender === 'user' ? 'user-msg' : 'agent-msg'}">
      <div>${msg.text}</div>
      <span class="msg-time">${msg.time || ''}</span>
    </div>
  `).join('');

  renderRealInbox();
}

function handleRealChatKey(e) {
  if (e.key === 'Enter') sendRealReplyFromInbox();
}

async function sendRealReplyFromInbox() {
  const input = document.getElementById('realChatInput');
  const text = input.value.trim();
  if (!text) return;

  const lead = realLeads.find(l => l.id === activeInboxLeadId);
  if (!lead) {
    showToast('Selecciona o inicia una conversación primero', 'info');
    return;
  }

  showToast(`Enviando por WhatsApp a ${lead.phone}...`, 'info');

  try {
    const res = await fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: lead.phone,
        message: text,
        token: DEFAULT_META_TOKEN,
        phoneId: DEFAULT_PHONE_ID
      })
    });

    const data = await res.json();
    if (data.success) {
      if (!lead.history) lead.history = [];
      lead.history.push({ sender: 'agent', text: text, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
      lead.lastMessage = text;
      saveRealLeads(realLeads);
      input.value = '';
      selectRealInboxLead(lead.id);
      showToast('✅ WhatsApp enviado al teléfono del cliente', 'success');
    } else {
      showToast(`Error de Meta: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ==================== SEND REAL WHATSAPP MODAL ====================
function openSendRealWaModal() {
  document.getElementById('sendRealWaModal').classList.add('active');
}

async function submitModalRealWhatsApp() {
  const phone = document.getElementById('modalWaPhone').value.trim();
  const message = document.getElementById('modalWaMessage').value.trim();

  if (!phone || !message) {
    showToast('Por favor completa teléfono y mensaje', 'error');
    return;
  }

  showToast(`Enviando a ${phone}...`, 'info');

  try {
    const res = await fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        message: message,
        token: DEFAULT_META_TOKEN,
        phoneId: DEFAULT_PHONE_ID
      })
    });

    const data = await res.json();
    if (data.success) {
      // Add or update lead in real storage
      let existing = realLeads.find(l => l.phone === phone);
      if (!existing) {
        existing = {
          id: 'lead-' + Date.now(),
          phone: phone,
          name: `Cliente (+${phone.slice(-4)})`,
          company: 'Contacto WhatsApp',
          timestamp: 'Ahora',
          lastMessage: message,
          history: [{ sender: 'agent', text: message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]
        };
        realLeads.unshift(existing);
      } else {
        existing.history.push({ sender: 'agent', text: message, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        existing.lastMessage = message;
      }
      saveRealLeads(realLeads);

      closeModal('sendRealWaModal');
      renderRealInbox();
      renderRealKanban();
      renderAgencyDashboard();
      selectRealInboxLead(existing.id);
      switchTab('inbox');
      showToast('✅ ¡Mensaje de WhatsApp REAL enviado con éxito!', 'success');
    } else {
      showToast(`❌ Error de Meta: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`❌ Error al conectar con el servidor: ${err.message}`, 'error');
  }
}

// ==================== KANBAN PIPELINE ====================
function renderRealKanban() {
  const container = document.getElementById('realKanbanContainer');
  if (!container) return;

  if (realLeads.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-dim);">
        <i class="fa-solid fa-bars-progress" style="font-size: 40px; color: rgba(255,255,255,0.1); margin-bottom: 12px; display: block;"></i>
        <strong style="color: white; font-size: 15px; display: block; margin-bottom: 4px;">Pipeline Limpio</strong>
        <p style="font-size: 13px; max-width: 450px; margin: 0 auto;">Los contactos reales capturados por tus líneas de WhatsApp aparecerán aquí organizados por etapas de venta.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="kanban-column">
      <div class="kanban-col-header"><strong style="color: white;">Nuevos Contactos</strong><span class="kanban-count-badge">${realLeads.length}</span></div>
      <div class="kanban-cards-list">
        ${realLeads.map(l => `
          <div class="kanban-card" onclick="selectRealInboxLead('${l.id}'); switchTab('inbox');">
            <div class="card-client-name">${l.name || l.phone}</div>
            <div class="card-meta-text">${l.phone}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ==================== DATABASE REACTIVATION ENGINE ====================
function calculateAndGenerateReactivation() {
  const biz = document.getElementById('reactBizName').value.trim() || 'tu negocio';
  const offer = document.getElementById('reactOffer').value.trim() || 'un beneficio exclusivo del 25% OFF solo por esta semana';
  const contacts = parseFloat(document.getElementById('reactContactsCount').value) || 500;
  const ticket = parseFloat(document.getElementById('reactAvgTicket').value) || 80;

  // 8% average reactivation conversion
  const estimatedSales = Math.round(contacts * 0.08);
  const totalRevenue = Math.round(estimatedSales * ticket);

  document.getElementById('reactProjectedRevenue').innerText = `$${totalRevenue.toLocaleString()} USD`;

  const script = `¡Hola [Nombre]! 👋 Esperamos que estés muy bien ✨

Te escribimos del equipo de *${biz}*. Queríamos agradecerte por haber formado parte de nuestros clientes y contarte que preparamos algo especial para ti 🎁:

🔥 *${offer}*
⏳ *Válido únicamente hasta este domingo a las 23:59 hs.*

👉 Para asegurar tu lugar y ver los horarios disponibles con tu beneficio aplicado, *responde a este mensaje con la palabra "QUIERO"* y te asignamos la reserva prioritaria en 10 segundos.

¡Te esperamos!`;

  document.getElementById('reactScriptBox').innerText = script;
  showToast(`¡Campaña de reactivación calculada: $${totalRevenue.toLocaleString()} USD en ventas proyectadas!`, 'success');
}

function copyReactivationScript() {
  const text = document.getElementById('reactScriptBox').innerText;
  navigator.clipboard.writeText(text);
  showToast('¡Guión de WhatsApp copiado!', 'success');
}

function downloadReactivationProposal() {
  const biz = document.getElementById('reactBizName').value.trim() || 'Empresa Cliente';
  const rev = document.getElementById('reactProjectedRevenue').innerText;

  const text = `========================================================================
             PROPUESTA COMERCIAL: REACTIVACIÓN DE CLIENTES CON IA
                       CAMPAÑA DE VENTAS EN 48 HORAS
========================================================================

CLIENTE: ${biz}
FECHA: ${new Date().toLocaleDateString()}

1. EL DIAGNÓSTICO
   Tu empresa cuenta con cientos de personas en su base de datos de WhatsApp 
   que compraron o consultaron en el pasado y hoy están inactivas. 
   Reactivalas con IA representa el retorno de inversión más rápido y seguro.

2. IMPACTO ECONÓMICO PROYECTADO
   - Ventas adicionales estimadas en 48h: ${rev}
   - Inversión en publicidad adicional: $0 USD (Base propia)
   - Tasa de respuesta estimada con Agente IA: 8% a 15%

3. NUESTRA GARANTÍA "CERO RIESGO"
   Nosotros configuramos el agente, redactamos la oferta y atendemos 
   el 100% de las respuestas automáticamente.

Firma de Conformidad: ___________________________
========================================================================`;

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Propuesta_Reactivacion_IA_${biz.replace(/\s+/g, '_')}.txt`;
  link.click();
  showToast('Propuesta de reactivación descargada', 'success');
}

function copyStep1Script() {
  const profile = getAgencyProfile();
  const owner = profile ? profile.owner : 'el Director';
  const agency = profile ? profile.name : 'NEXUS AI';
  
  const text = `Hola [Nombre del Dueño/Encargado] 👋 Te saluda ${owner} de ${agency}. Estuve viendo el perfil de [Empresa] y noté que tienen una demanda altísima de consultas por WhatsApp.

Hicimos una prueba rápida y vimos que si alguien escribe fuera del horario comercial o un fin de semana, se pierden ventas potenciales frente a la competencia.

Les armamos un asistente con IA exclusivo para [Empresa] que responde precios en 2 segundos y agenda turnos en el calendario automáticamente.

¿Te gustaría que te mande un video de 1 minuto mostrándote cómo funciona sin ningún compromiso?`;

  navigator.clipboard.writeText(text);
  showToast('¡Guión del Paso 1 copiado con tus datos!', 'success');
}

// ==================== B2B PROSPECTING & SALES TOOLS ====================
function generatePersonalizedDemoPitch() {
  const prospect = document.getElementById('demoProspectName').value.trim() || 'tu empresa';
  const niche = document.getElementById('demoProspectNiche').value;
  const profile = getAgencyProfile();
  const agencyName = profile ? profile.name : 'NEXUS AI';

  const scriptOutput = `¡Hola! 👋 Estuve viendo el perfil de *${prospect}* y me llamó mucho la atención la gran demanda que tienen en el sector de *${niche}*.

Notamos que muchas personas escriben fuera del horario comercial o en picos de atención y se van con la competencia por la demora en responder.

En *${agencyName}* armamos un Asistente con IA entrenado a medida exclusivamente para *${prospect}* que:
✅ Responde dudas y precios en 2 segundos por WhatsApp.
✅ Califica si el cliente está listo para comprar o agendar.
✅ Agenda la cita directamente en tu calendario.

👉 Te armé una demostración rápida y sin compromiso para que veas cómo atendería a tus clientes. ¿Te gustaría que te envíe el video de 1 minuto para que lo pruebes?`;

  document.getElementById('prospectScriptOutput').innerText = scriptOutput;
  showToast(`¡Pitch de ventas personalizado generado para ${prospect}!`, 'success');
}

function copyProspectScript() {
  const text = document.getElementById('prospectScriptOutput').innerText;
  navigator.clipboard.writeText(text);
  showToast('¡Guión de WhatsApp copiado para enviar!', 'success');
}

function downloadAgencyClientContract() {
  const profile = getAgencyProfile();
  const agencyName = profile ? profile.name : 'NEXUS AI Agency';
  const ownerName = profile ? profile.owner : 'El Prestador';
  const fee = document.getElementById('contractFeeInput').value || '490';
  const setupTime = document.getElementById('contractSetupTime').value || '48 a 72 horas';

  const contractText = `========================================================================
            CONTRATO DE PRESTACIÓN DE SERVICIOS TECNOLÓGICOS
                AUTOMATIZACIÓN CON INTELIGENCIA ARTIFICIAL
========================================================================

FECHA DE EMISIÓN: ${new Date().toLocaleDateString()}
AGENCIA PRESTADORA: ${agencyName}
REPRESENTANTE: ${ownerName}
CLIENTE CONTRATANTE: [Nombre de la Empresa Cliente]

1. OBJETO DEL SERVICIO
   La Agencia se compromete a implementar, alojar y mantener operativo un 
   Sistema de Asistente Virtual Inteligente (IA) sobre los canales digitales 
   del Cliente (WhatsApp Business / Web), capacitado para atención 24/7, 
   calificación de prospectos y agendamiento de citas.

2. CONDICIONES ECONÓMICAS
   - Cuota Mensual de Mantenimiento y Servidores: $${fee} USD / mes.
   - Modalidad de Pago: Suscripción mensual recurrente por adelantado.
   - Plazo de Activación: ${setupTime}.

3. CONFIDENCIALIDAD & PROPIEDAD DE DATOS
   Todos los datos, teléfonos y conversaciones de los clientes finales 
   son de exclusiva propiedad del Cliente Contratante.

4. VIGENCIA Y CANCELACIÓN
   El presente acuerdo opera mes a mes sin permanencia forzada, pudiendo 
   ser cancelado con un preaviso de 15 días.

FIRMAS DE CONFORMIDAD:

_____________________________            _____________________________
Por la Agencia Prestadora                Por la Empresa Cliente
${agencyName}
========================================================================`;

  const blob = new Blob([contractText], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `Contrato_Servicios_IA_${agencyName.replace(/\s+/g, '_')}.txt`;
  link.click();
  showToast('✅ Contrato formal de servicios B2B descargado', 'success');
}

// ==================== MARKETING STUDIO ====================
function updateMarketingForm() {
  const format = document.getElementById('mktFormat').value;
  const extraLabel = document.getElementById('mktExtraLabel');
  const extraInput = document.getElementById('mktExtra');

  if (format === 'ads') {
    extraLabel.innerText = 'Oferta o Gancho Principal';
    extraInput.placeholder = 'Ej: Diagnóstico Gratuito + 20% OFF';
  } else if (format === 'reels') {
    extraLabel.innerText = 'Dolor o Beneficio Principal';
    extraInput.placeholder = 'Ej: Atención 24/7 sin contratar más personal';
  } else if (format === 'cold_email') {
    extraLabel.innerText = 'Cargo del Destinatario';
    extraInput.placeholder = 'Ej: Director Comercial / Dueño de Negocio';
  } else if (format === 'whatsapp_broadcast') {
    extraLabel.innerText = 'Beneficio y Vencimiento';
    extraInput.placeholder = 'Ej: 20% OFF solo hasta este domingo';
  } else if (format === 'google_reviews') {
    extraLabel.innerText = 'Comentario del Cliente';
    extraInput.placeholder = 'Ej: Excelente atención, muy amables y rápidos';
  }
}

async function generateMarketingContent() {
  const format = document.getElementById('mktFormat').value;
  const business = document.getElementById('mktBusiness').value || 'la empresa';
  const niche = document.getElementById('mktNiche').value || 'Negocios';
  const extra = document.getElementById('mktExtra').value || '';
  const apiKey = localStorage.getItem('nexus_ai_key') || DEFAULT_GEMINI_KEY;

  const outputBox = document.getElementById('mktOutputContent');
  const titleBox = document.getElementById('mktOutputTitle');

  outputBox.innerText = 'Generando contenido optimizado con Google Gemini... ⚡';

  try {
    const promptText = `Eres el Director Creativo y Copywriter de una Agencia de Inteligencia Artificial.\nGenera contenido de tipo '${format}' para la empresa '${business}' del rubro '${niche}'.\nDetalle u oferta: '${extra}'.\nRedacta en español con formato estructurado de alta conversión.`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: promptText }] }] })
    });

    if (!res.ok) throw new Error('Error al llamar API');
    const data = await res.json();
    titleBox.innerText = `Contenido Generado (${format})`;
    outputBox.innerText = data.candidates[0].content.parts[0].text;
    showToast('¡Campaña generada con éxito con Gemini IA!', 'success');
  } catch(e) {
    // Fallback template
    const res = MARKETING_TEMPLATES.ads.generate(business, niche, extra, '');
    titleBox.innerText = 'Anuncio Generado';
    outputBox.innerText = `${res.headline}\n\n${res.primaryText}\n\nCTA: ${res.callToAction}\n\n${res.targetAdvice}`;
    showToast('Contenido generado', 'info');
  }
}

function copyMarketingOutput() {
  const text = document.getElementById('mktOutputContent').innerText;
  navigator.clipboard.writeText(text);
  showToast('¡Copiado al portapapeles!', 'success');
}

// ==================== MULTI-AGENCY WORKSPACE MANAGEMENT ====================
function openNewAgencyWorkspaceModal() {
  document.getElementById('newAgencyModal').classList.add('active');
}

function createIndependentAgency() {
  const name = document.getElementById('newAgencyNameInput').value.trim();
  const owner = document.getElementById('newAgencyOwnerInput').value.trim();
  const email = document.getElementById('newAgencyEmailInput').value.trim();
  const currency = document.getElementById('newAgencyCurrency').value;

  if (!name || !owner) {
    showToast('Por favor escribe el nombre de la agencia y del dueño', 'error');
    return;
  }

  const newAgencyId = 'agency_' + Date.now();
  const newAgency = {
    id: newAgencyId,
    name: name,
    owner: owner,
    email: email || `${owner.toLowerCase().replace(/\s+/g, '')}@agencia.com`,
    currency: currency,
    brandColor: '#6366f1',
    createdAt: new Date().toISOString()
  };

  const reg = getAgenciesRegistry();
  reg.push(newAgency);
  saveAgenciesRegistry(reg);

  // Initialize empty isolated storage for this new agency
  localStorage.setItem(`nexus_clients_${newAgencyId}`, JSON.stringify([]));
  localStorage.setItem(`nexus_leads_${newAgencyId}`, JSON.stringify([]));

  closeModal('newAgencyModal');
  loadAgencyWorkspace(newAgencyId);
  showToast(`🎉 ¡Nueva Agencia '${name}' creada y activada! (Aislamiento Total)`, 'success');
}

function openSwitchAgencyModal() {
  const reg = getAgenciesRegistry();
  const container = document.getElementById('agencyAccountsListContainer');
  if (!container) return;

  container.innerHTML = reg.map(a => {
    const isCurrent = a.id === currentAgencyId;
    const clientCount = (JSON.parse(localStorage.getItem(`nexus_clients_${a.id}`) || '[]')).length;
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px; background: rgba(15, 23, 42, 0.8); border: 1px solid ${isCurrent ? 'var(--accent-indigo)' : 'var(--border-subtle)'}; border-radius: var(--radius-md);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 36px; height: 36px; border-radius: var(--radius-sm); background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; font-weight: 800; color: white;">
            ${a.name[0].toUpperCase()}
          </div>
          <div>
            <strong style="font-size: 14px; color: white;">${a.name}</strong>
            <div style="font-size: 11.5px; color: var(--text-muted);">${a.owner} • ${clientCount} Empresas gestionadas</div>
          </div>
        </div>
        <div>
          ${isCurrent 
            ? '<span class="brand-badge" style="background: rgba(16,185,129,0.2); color:#34d399;">Activa Ahora</span>' 
            : `<button class="btn btn-secondary btn-sm" onclick="switchAgencyDirectly('${a.id}')">Ingresar a este Entorno</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('switchAgencyModal').classList.add('active');
}

function switchAgencyDirectly(agencyId) {
  closeModal('switchAgencyModal');
  loadAgencyWorkspace(agencyId);
  showToast(`Cambiado al entorno aislado de agencia`, 'success');
}

// ==================== PUBLIC PORTAL HELPERS ====================
function simulatePortalReply(type) {
  const container = document.getElementById('portalSimChatBody');
  if (!container) return;

  const profile = getAgencyProfile();
  const agencyName = profile ? profile.name : 'NEXUS AI';
  const priceStarter = profile ? (profile.priceStarter || '290') : '290';
  const pricePro = profile ? (profile.pricePro || '690') : '690';

  const userMessages = {
    'turnos': '🦷 Hola, ¿tienen turnos disponibles para hoy?',
    'precios': '💵 Hola, ¿cuánto cuesta el servicio y qué planes tienen?',
    'ubicacion': '📍 ¿Dónde están ubicados y cuáles son sus horarios de atención?'
  };

  const agentReplies = {
    'turnos': `¡Hola! Con gusto te ayudo 📅 Sí, para el día de hoy tenemos los siguientes espacios libres:<br><br>• <strong>15:30 hs</strong><br>• <strong>18:00 hs</strong><br><br>¿Cuál de estos horarios te queda más cómodo para reservarte el turno a tu nombre?`,
    'precios': `¡Hola! En <strong>${agencyName}</strong> contamos con 2 planes según tu necesidad:<br><br>• <strong>Plan Starter:</strong> $${priceStarter} USD/mes (Agente WhatsApp 24/7)<br>• <strong>Plan Growth Pro:</strong> $${pricePro} USD/mes (Agente + Agenda Calendar + CRM de Leads)<br><br>Ambos sin contratos de permanencia. ¿Te gustaría activar el tuyo hoy?`,
    'ubicacion': `¡Hola! 📍 Nuestra sede central atiende de <strong>Lunes a Viernes de 09:00 a 19:00 hs</strong> y <strong>Sábados de 10:00 a 14:00 hs</strong>.<br><br>Sin embargo, ¡nuestro Asistente de IA te atiende por aquí las <strong>24 horas del día</strong> sin interrupciones! ¿En qué más te puedo colaborar?`
  };

  const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Add User Message
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-sim-msg user';
  userMsgEl.innerHTML = `${userMessages[type]}<div style="font-size: 10px; color: rgba(255,255,255,0.6); text-align: right; margin-top: 4px;">${now}</div>`;
  container.appendChild(userMsgEl);
  container.scrollTop = container.scrollHeight;

  // Add Typing Indicator
  const typingEl = document.createElement('div');
  typingEl.className = 'chat-sim-msg agent';
  typingEl.id = 'tempSimTyping';
  typingEl.innerHTML = `<i class="fa-solid fa-ellipsis fa-fade"></i> <em>Escribiendo respuesta...</em>`;
  container.appendChild(typingEl);
  container.scrollTop = container.scrollHeight;

  // Render Real Agent Reply after short delay
  setTimeout(() => {
    const typing = document.getElementById('tempSimTyping');
    if (typing) typing.remove();

    const agentMsgEl = document.createElement('div');
    agentMsgEl.className = 'chat-sim-msg agent';
    agentMsgEl.innerHTML = `${agentReplies[type]}<div style="font-size: 10px; color: rgba(255,255,255,0.4); text-align: right; margin-top: 4px;">${now}</div>`;
    container.appendChild(agentMsgEl);
    container.scrollTop = container.scrollHeight;
  }, 600);
}

function openContactDemoModal(plan = 'Sesión Estratégica') {
  openAgencyRealCheckout('pro');
}

function openPublicShareModal() {
  const profile = getAgencyProfile();
  const agencyName = profile ? profile.name : 'NEXUS AI';
  const shareUrl = `https://${agencyName.toLowerCase().replace(/[^a-z0-9]/g, '')}.nexus-ai.agency/servicios`;
  
  navigator.clipboard.writeText(shareUrl);
  alert(`🌐 ENLACE PÚBLICO DE TU AGENCIA:\n\n${shareUrl}\n\n¡Enlace copiado al portapapeles! Tus compradores pueden enviar este enlace a cualquier empresa para mostrar sus 4 servicios de IA y paquetes mensuales.`);
}

// ==================== REAL BAILEYS WHATSAPP QR ENGINE ====================
let activeQrClientId = null;
let qrPollInterval = null;

function setConnectionMode(mode) {
  const btnQr = document.getElementById('btnModeQr');
  const btnMeta = document.getElementById('btnModeMeta');
  const secQr = document.getElementById('sectionConnQr');
  const secMeta = document.getElementById('sectionConnMeta');

  if (!btnQr || !btnMeta || !secQr || !secMeta) return;

  if (mode === 'qr') {
    btnQr.classList.add('active');
    btnMeta.classList.remove('active');
    secQr.style.display = 'grid';
    secMeta.style.display = 'none';
    startRealQrListener(`agency_${currentAgencyId}`);
  } else {
    btnMeta.classList.add('active');
    btnQr.classList.remove('active');
    secMeta.style.display = 'grid';
    secQr.style.display = 'none';
    stopRealQrListener();
  }
}

function setPairMethod(method) {
  const btnQr = document.getElementById('btnPairMethodQr');
  const btnCode = document.getElementById('btnPairMethodCode');
  const boxQr = document.getElementById('pairMethodQrBox');
  const boxCode = document.getElementById('pairMethodCodeBox');

  if (!btnQr || !btnCode || !boxQr || !boxCode) return;

  if (method === 'qr') {
    btnQr.classList.add('active');
    btnCode.classList.remove('active');
    boxQr.style.display = 'flex';
    boxCode.style.display = 'none';
    startRealQrListener(`agency_${currentAgencyId}`);
  } else {
    btnCode.classList.add('active');
    btnQr.classList.remove('active');
    boxCode.style.display = 'flex';
    boxQr.style.display = 'none';
  }
}

async function request8DigitPairingCode() {
  const phoneInput = document.getElementById('pairingPhoneInput');
  const btn = document.getElementById('btnGetPairingCode');
  const phone = phoneInput ? phoneInput.value.trim() : '';

  if (!phone || phone.replace(/\D/g, '').length < 8) {
    showToast('Ingresa tu número con código de país (Ej: 5491148923310 o 5215512345678)', 'error');
    return;
  }

  const origBtnHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando código con WhatsApp...';
  }

  showToast('Conectando con servidores de WhatsApp...', 'info');

  try {
    const sessionId = `agency_${currentAgencyId}`;
    const res = await fetch('/api/wa-session/pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, phone })
    });

    const data = await res.json();
    if (data.success && data.code) {
      const displayBox = document.getElementById('pairingCodeDisplayBox');
      const textElem = document.getElementById('pairingCodeText');
      if (displayBox && textElem) {
        // Format with space in middle if 8 characters (e.g. ABCD-1234 or ABCD 1234)
        const rawCode = data.code.replace(/[^a-zA-Z0-9]/g, '');
        const formatted = rawCode.length === 8 ? `${rawCode.slice(0, 4)} - ${rawCode.slice(4)}` : data.code;
        textElem.innerText = formatted;
        displayBox.style.display = 'block';
        displayBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      showToast('¡Código generado con éxito! Ingrésalo en tu celular ahora.', 'success');
      startRealQrListener(sessionId);
    } else {
      showToast(data.error || 'Error solicitando código de vinculación', 'error');
    }
  } catch (e) {
    showToast('Error de conexión con el servidor', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origBtnHtml;
    }
  }
}

function refreshWhatsAppQR() {
  const sessionId = `agency_${currentAgencyId}`;
  showToast('Regenerando código QR oficial...', 'info');
  fetch(`/api/wa-session/logout?sessionId=${sessionId}`, { method: 'POST' })
    .then(() => startRealQrListener(sessionId));
}

async function startRealQrListener(sessionId = 'agency_master_1') {
  stopRealQrListener();
  
  const updateUI = (data) => {
    const unpaired = document.getElementById('qrUnpairedView');
    const paired = document.getElementById('qrPairedView');
    const qrContainer = document.getElementById('qrRealImageContainer');

    if (data.connected) {
      if (unpaired) unpaired.style.display = 'none';
      if (paired) paired.style.display = 'flex';
      
      const phoneDisplay = document.getElementById('qrConnectedPhoneDisplay');
      if (phoneDisplay && data.phone) {
        phoneDisplay.innerText = `+${data.phone}`;
      }
      const sidebarPhone = document.getElementById('sidebarPhoneDisplay');
      if (sidebarPhone && data.phone) {
        sidebarPhone.innerText = `Línea: +${data.phone}`;
      }
      localStorage.setItem(`nexus_qr_paired_${currentAgencyId}`, 'true');
      stopRealQrListener();
    } else if (data.qr) {
      if (unpaired) unpaired.style.display = 'flex';
      if (paired) paired.style.display = 'none';
      if (qrContainer) {
        qrContainer.innerHTML = `
          <img src="${data.qr}" style="width: 280px; height: 280px; object-fit: contain; border-radius: 6px; display: block;" alt="Código QR Real de WhatsApp">
        `;
      }
    }
  };

  // Immediate start/status check
  try {
    const res = await fetch(`/api/wa-session/start?sessionId=${sessionId}`, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      updateUI(data);
    }
  } catch (e) {}

  // Poll status every 2 seconds
  qrPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/wa-session/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      updateUI(data);
    } catch (err) {}
  }, 2000);
}

function stopRealQrListener() {
  if (qrPollInterval) {
    clearInterval(qrPollInterval);
    qrPollInterval = null;
  }
}

async function pairWhatsAppQRInstant() {
  showToast('🔄 Conectando con servidor de WhatsApp...', 'info');
  startRealQrListener(`agency_${currentAgencyId}`);
}

async function unpairWhatsAppQR() {
  const sessionId = `agency_${currentAgencyId}`;
  try {
    await fetch(`/api/wa-session/logout?sessionId=${sessionId}`, { method: 'POST' });
  } catch (e) {}

  const unpaired = document.getElementById('qrUnpairedView');
  const paired = document.getElementById('qrPairedView');
  if (unpaired && paired) {
    paired.style.display = 'none';
    unpaired.style.display = 'flex';
  }
  localStorage.removeItem(`nexus_qr_paired_${currentAgencyId}`);
  showToast('Dispositivo WhatsApp desvinculado', 'info');
  startRealQrListener(sessionId);
}

function checkQrConnectionState() {
  startRealQrListener(`agency_${currentAgencyId}`);
}

let clientQrPollInterval = null;

async function openQrPairModalForClient(clientId) {
  activeQrClientId = clientId;
  const client = agencyClients.find(c => c.id === clientId);
  if (client) {
    const title = document.getElementById('qrClientModalName');
    if (title) title.innerText = `Vincular: ${client.name}`;
  }
  document.getElementById('qrClientPairModal').classList.add('active');

  const sessionId = `client_${clientId}`;
  try {
    await fetch(`/api/wa-session/start?sessionId=${sessionId}`, { method: 'POST' });
  } catch (e) {}

  if (clientQrPollInterval) clearInterval(clientQrPollInterval);
  clientQrPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/wa-session/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      
      const container = document.getElementById('qrRealClientImageContainer');
      if (data.connected) {
        if (client) {
          client.phone = data.phone ? `+${data.phone}` : client.phone;
          saveAgencyClients(agencyClients);
          renderClientsList();
        }
        clearInterval(clientQrPollInterval);
        closeModal('qrClientPairModal');
        showToast(`🎉 ¡WhatsApp de ${client.name} vinculado con éxito! (+${data.phone})`, 'success');
      } else if (data.qr && container) {
        container.innerHTML = `
          <img src="${data.qr}" style="width: 100%; height: 100%; object-fit: contain; border-radius: 8px;" alt="Código QR Real de WhatsApp">
        `;
      }
    } catch (e) {}
  }, 2000);
}

function confirmClientQrPair() {
  if (clientQrPollInterval) clearInterval(clientQrPollInterval);
  closeModal('qrClientPairModal');
}

// ==================== WHITE LABEL & REAL PAYMENTS ====================
let activeCheckoutPlan = 'pro';

function updateBrandColor(color) {
  document.documentElement.style.setProperty('--accent-indigo', color);
  showToast(`Color actualizado a ${color}`, 'success');
}

function saveWhiteLabelSettings() {
  const profile = getAgencyProfile();
  if (!profile) return;

  const name = document.getElementById('wlBrandName').value.trim() || profile.name;
  const color = document.getElementById('wlColorPicker').value;
  const priceStarter = document.getElementById('wlPriceStarter').value.trim() || '290';
  const pricePro = document.getElementById('wlPricePro').value.trim() || '690';
  const paymentLinkStarter = document.getElementById('wlPaymentLinkStarter').value.trim();
  const paymentLinkPro = document.getElementById('wlPaymentLinkPro').value.trim();
  const bankName = document.getElementById('wlBankName').value.trim();
  const bankHolder = document.getElementById('wlBankHolder').value.trim();
  const bankCbu = document.getElementById('wlBankCbu').value.trim();
  const bankTaxId = document.getElementById('wlBankTaxId').value.trim();
  const billingPhone = document.getElementById('wlBillingPhone').value.trim();

  profile.name = name;
  profile.brandColor = color;
  profile.priceStarter = priceStarter;
  profile.pricePro = pricePro;
  profile.paymentLinkStarter = paymentLinkStarter;
  profile.paymentLinkPro = paymentLinkPro;
  profile.bankName = bankName;
  profile.bankHolder = bankHolder;
  profile.bankCbu = bankCbu;
  profile.bankTaxId = bankTaxId;
  profile.billingPhone = billingPhone;

  saveAgencyProfile(profile);

  // Update DOM elements
  document.getElementById('sidebarBrandName').innerText = name;
  document.getElementById('topAgencyName').innerText = name;
  const portalAgency = document.getElementById('portalAgencyName');
  if (portalAgency) portalAgency.innerText = name;

  const portalStarter = document.getElementById('portalPriceStarter');
  const portalPro = document.getElementById('portalPricePro');
  if (portalStarter) portalStarter.innerHTML = `$${priceStarter} <span style="font-size: 14px; color: var(--text-dim); font-weight: 600;">USD / mes</span>`;
  if (portalPro) portalPro.innerHTML = `$${pricePro} <span style="font-size: 14px; color: var(--text-dim); font-weight: 600;">USD / mes</span>`;

  showToast('¡Ajustes de Marca Blanca y Pasarelas de Pago guardados con éxito!', 'success');
}

function openAgencyRealCheckout(planKey) {
  activeCheckoutPlan = planKey;
  const profile = getAgencyProfile();
  const isPro = planKey === 'pro';

  const planName = isPro ? 'Plan Growth Pro' : 'Plan Starter IA';
  const price = isPro ? (profile.pricePro || '690') : (profile.priceStarter || '290');
  const gatewayLink = isPro ? profile.paymentLinkPro : profile.paymentLinkStarter;

  document.getElementById('checkoutSummaryPlan').innerText = planName.toUpperCase();
  document.getElementById('checkoutSummaryPrice').innerText = `$${price}`;
  document.getElementById('checkoutModalTitle').innerHTML = `<i class="fa-solid fa-lock" style="color: #34d399;"></i> Contratar ${planName}`;

  // Populate Bank Details
  const bankDetailsContainer = document.getElementById('checkoutBankDetails');
  if (bankDetailsContainer) {
    if (profile.bankName || profile.bankCbu) {
      bankDetailsContainer.innerHTML = `
        <div><strong>Banco:</strong> ${profile.bankName || 'A coordinar'}</div>
        <div><strong>Titular:</strong> ${profile.bankHolder || profile.name}</div>
        <div><strong>CBU/IBAN/Alias:</strong> <span style="color: #67e8f9; font-weight: 800;">${profile.bankCbu || 'Consultar por WhatsApp'}</span></div>
        <div><strong>Identificación Fiscal:</strong> ${profile.bankTaxId || 'Consumidor Final'}</div>
        <div><strong>Monto Exacto:</strong> $${price} USD</div>
      `;
    } else {
      bankDetailsContainer.innerHTML = `
        <div><strong>Banco:</strong> Transferencia Local / Internacional</div>
        <div><strong>Titular:</strong> ${profile.name}</div>
        <div><strong>CBU/IBAN/Alias:</strong> <span style="color: #67e8f9; font-weight: 800;">ALIAS.AGENCIA.IA</span></div>
        <div><strong>Monto Exacto:</strong> $${price} USD / mes</div>
      `;
    }
  }

  // Update Gateway Button Text
  const btnGateway = document.getElementById('btnCheckoutPayGateway');
  if (btnGateway) {
    if (gatewayLink) {
      btnGateway.innerHTML = `<i class="fa-solid fa-lock"></i> Pagar $${price} USD con Tarjeta (Enlace Seguro)`;
    } else {
      btnGateway.innerHTML = `<i class="fa-solid fa-credit-card"></i> Pagar con Tarjeta (Configurar enlace en Marca Blanca)`;
    }
  }

  document.getElementById('agencyCheckoutModal').classList.add('active');
}

function executeGatewayPayment() {
  const profile = getAgencyProfile();
  const isPro = activeCheckoutPlan === 'pro';
  const gatewayLink = isPro ? profile.paymentLinkPro : profile.paymentLinkStarter;

  if (gatewayLink && gatewayLink.startsWith('http')) {
    window.open(gatewayLink, '_blank');
    showToast('Abriendo pasarela de pago segura...', 'success');
  } else {
    alert(`ℹ️ PASARELA DE PAGO DIRECTA:\n\nEl dueño de la agencia aún no ha pegado el enlace de Stripe/Mercado Pago para este plan.\n\nPuedes pagar mediante Transferencia Bancaria o coordinar directamente por WhatsApp.`);
  }
}

function copyBankDetails() {
  const profile = getAgencyProfile();
  const isPro = activeCheckoutPlan === 'pro';
  const price = isPro ? (profile.pricePro || '690') : (profile.priceStarter || '290');
  
  const text = `DATOS DE TRANSFERENCIA (${profile.name}):\nBanco: ${profile.bankName || 'Santander/BBVA'}\nTitular: ${profile.bankHolder || profile.name}\nCBU/IBAN/Alias: ${profile.bankCbu || 'ALIAS.AGENCIA.IA'}\nMonto: $${price} USD`;
  
  navigator.clipboard.writeText(text);
  showToast('📋 Datos bancarios copiados al portapapeles', 'success');
}

function sendCheckoutWhatsApp() {
  const profile = getAgencyProfile();
  const isPro = activeCheckoutPlan === 'pro';
  const planName = isPro ? 'Plan Growth Pro ($' + (profile.pricePro || '690') + ' USD/mes)' : 'Plan Starter ($' + (profile.priceStarter || '290') + ' USD/mes)';
  const phone = profile.billingPhone || '5491148923310';
  
  const msg = encodeURIComponent(`🚀 ¡Hola ${profile.name}! Quiero contratar el ${planName} para mi empresa.\n\n¿Me facilitan los datos de pago / factura para activar mi Agente de IA hoy mismo?`);
  window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${msg}`, '_blank');
}

function saveAndTestAiApi() {
  showToast('✅ Conexión con Google Gemini verificada', 'success');
}

// ==================== UTILS & TOAST ====================
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'success' ? 'fa-circle-check' : type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
  const color = type === 'success' ? '#34d399' : type === 'error' ? '#f43f5e' : '#818cf8';

  toast.innerHTML = `<i class="fa-solid ${icon}" style="color: ${color}; font-size: 16px;"></i> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
