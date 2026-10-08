// NEXUS AI - Production Data Model & Starter Blueprints (Zero Fake Leads)

// Industry Blueprints (Pre-trained System Prompt Templates for New Clients)
const AGENCY_BLUEPRINTS = [
  {
    id: "salud_clinicas",
    category: "Salud & Clínicas",
    name: "Agente Médico & Odontológico",
    icon: "🏥",
    description: "Triaje preliminar, agendamiento de turnos y recordatorios automáticos.",
    defaultSystemPrompt: "Eres el asistente virtual médico de la clínica. Atiende con calidez, califica urgencias y solicita nombre, motivo de consulta y horario preferido para agendar con el especialista."
  },
  {
    id: "inmobiliarias",
    category: "Bienes Raíces & Inmobiliarias",
    name: "Asesor Inmobiliario Digital",
    icon: "🏢",
    description: "Calificación de compradores por presupuesto y agendamiento de visitas guiadas.",
    defaultSystemPrompt: "Eres el asesor inmobiliario virtual. Filtra por compra o alquiler, zona de interés, presupuesto estimado y método de pago antes de agendar una visita presencial."
  },
  {
    id: "belleza_barberias",
    category: "Belleza & Cuidado Personal",
    name: "Recepcionista de Salón & Barbería",
    icon: "✂️",
    description: "Reserva de turnos por profesional, lista de precios y confirmaciones.",
    defaultSystemPrompt: "Eres el recepcionista digital del salón. Muestra el menú de servicios, consulta con qué profesional desea atenderse y confirma el turno con nombre y teléfono."
  },
  {
    id: "gastronomia",
    category: "Restaurantes & Gastronomía",
    name: "Anfitrión & Delivery Bot",
    icon: "🍽️",
    description: "Reservas de mesas para grupos, carta digital y toma de pedidos a domicilio.",
    defaultSystemPrompt: "Eres el anfitrión digital del restaurante. Gestiona reservas solicitando fecha, hora y cantidad de personas, o toma pedidos de delivery con dirección exacta y método de pago."
  },
  {
    id: "servicios_b2b",
    category: "Empresas & Servicios B2B",
    name: "Calificador de Clientes B2B",
    icon: "⚖️",
    description: "Diagnóstico comercial, scoring de empresas y agendamiento en Google Meet / Zoom.",
    defaultSystemPrompt: "Eres el asesor corporativo de la empresa. Identifica las necesidades del cliente, evalúa el tamaño de la empresa y coordina una reunión estratégica por videollamada."
  },
  {
    id: "ecommerce_retail",
    category: "E-Commerce & Retail",
    name: "Soporte de Tienda Online",
    icon: "🛍️",
    description: "Recomendación de productos, estado de envíos y resolución de dudas de compra.",
    defaultSystemPrompt: "Eres el asistente de la tienda online. Asiste en dudas de talles, envíos y medios de pago para maximizar la conversión de ventas."
  }
];

// Production State Helper Functions
function getStoredAgencyClients() {
  const data = localStorage.getItem('nexus_agency_clients');
  return data ? JSON.parse(data) : [];
}

function saveAgencyClients(clients) {
  localStorage.setItem('nexus_agency_clients', JSON.stringify(clients));
}

function getStoredRealLeads() {
  const data = localStorage.getItem('nexus_real_leads');
  return data ? JSON.parse(data) : [];
}

function saveRealLeads(leads) {
  localStorage.setItem('nexus_real_leads', JSON.stringify(leads));
}

function getStoredRealEvents() {
  const data = localStorage.getItem('nexus_real_events');
  return data ? JSON.parse(data) : [];
}

function saveRealEvents(events) {
  localStorage.setItem('nexus_real_events', JSON.stringify(events));
}
