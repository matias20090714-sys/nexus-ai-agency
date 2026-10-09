// NEXUS AI - Production Multi-Tenant Multi-Flow Data Model & Blueprints

window.escapeHtml = function(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Industry Blueprints (Pre-trained System Prompt Templates for New Clients)
const AGENCY_BLUEPRINTS = [
  {
    id: "salud_clinicas",
    category: "Salud & Clínicas",
    name: "Agente Médico & Odontológico",
    icon: "🏥",
    description: "Triaje preliminar, agendamiento de turnos y recordatorios automáticos.",
    defaultSystemPrompt: "Eres el asistente virtual médico de la clínica. Atiende con calidez, califica urgencias y solicita nombre, motivo de consulta y horario preferido para agendar con el especialista.",
    defaultCatalog: [
      { id: "srv_1", name: "Consulta Odontológica General & Diagnóstico", price: 35, duration: "30 min", description: "Evaluación clínica completa con cámara intraoral y radiografía digital." },
      { id: "srv_2", name: "Limpieza Dental Ultrasónica & Profilaxis", price: 60, duration: "45 min", description: "Remoción de sarro, pulido dental y aplicación de flúor protector." },
      { id: "srv_3", name: "Blanqueamiento Dental LED Avanzado", price: 180, duration: "60 min", description: "Aclarado de hasta 4 tonos en 1 sola sesión sin sensibilidad." },
      { id: "srv_4", name: "Ortodoncia Invisible (Alineadores 3D)", price: 850, duration: "45 min", description: "Planificación digital y juego de alineadores transparentes personalizados." }
    ],
    salesFlow: {
      qualification: "¿Presentas algún dolor agudo o buscas una consulta preventiva?",
      objections: "Si el paciente consulta por precio, enfatiza que incluye diagnóstico digital completo y facilidades de pago en hasta 6 cuotas.",
      closing: "Para reservar tu espacio médico exclusivo, por favor indícame tu Nombre y Horario preferido (Mañana o Tarde)."
    },
    supportFlow: {
      faqs: "Q: ¿Aceptan seguros médicos? R: Sí, trabajamos con reintegros directos y las principales coberturas.\nQ: ¿Dónde se encuentran? R: Av. Principal 123, Piso 4 con estacionamiento gratuito.",
      emergency: "En caso de traumatismo o dolor agudo nocturno, comunícate a nuestra línea de guardia directa."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 4,
      message: "¡Hola {nombre}! Esperamos que tu consulta de hoy en {empresa} haya sido excelente. Del 1 al 10, ¿cómo calificarías nuestra atención?",
      googleReviewUrl: "https://g.page/r/tu-clinica/review",
      googleReviewPrompt: "¡Muchas gracias por tu 10! Si nos dejas una breve reseña en Google Maps nos ayudas muchísimo: {link}",
      loyaltyDiscount: "15% de descuento en tu próxima limpieza para un familiar."
    }
  },
  {
    id: "inmobiliarias",
    category: "Bienes Raíces & Inmobiliarias",
    name: "Asesor Inmobiliario Digital",
    icon: "🏢",
    description: "Calificación de compradores por presupuesto y agendamiento de visitas guiadas.",
    defaultSystemPrompt: "Eres el asesor inmobiliario virtual. Filtra por compra o alquiler, zona de interés, presupuesto estimado y método de pago antes de agendar una visita presencial.",
    defaultCatalog: [
      { id: "srv_5", name: "Departamento 2 Ambientes con Balcón & Cochera", price: 85000, duration: "Visita 30 min", description: "A estrenar, amenities completos, piscina y seguridad 24hs." },
      { id: "srv_6", name: "Casa Residencial en Barrio Privado (3 Dorm)", price: 210000, duration: "Visita 45 min", description: "Terreno de 600m2 con parque, quincho y piscina climatizada." },
      { id: "srv_7", name: "Tasación Inmobiliaria Profesional & Análisis de Mercado", price: 0, duration: "48 hs", description: "Valuación técnica sin costo para propietarios que buscan vender rápido." }
    ],
    salesFlow: {
      qualification: "¿Buscas comprar para vivienda propia o como inversión con renta?",
      objections: "Si el cliente duda de la financiación, explica que contamos con créditos hipotecarios directos y planes en cuotas fijas.",
      closing: "Te puedo coordinar una visita privada este Sábado a las 11:00 o 16:00 hs. ¿Cuál te queda mejor?"
    },
    supportFlow: {
      faqs: "Q: ¿Cuáles son los requisitos de alquiler? R: Garantía propietaria o seguro de caución + 3 recibos de sueldo.\nQ: ¿Cuánto cobran de comisión? R: Comisión estándar de ley del 4% en ventas.",
      emergency: "Para emergencias de consorcio o llaves, contacta a administración."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 24,
      message: "Hola {nombre}, ¿cómo estuvo tu visita a la propiedad con nuestro asesor? Queremos asegurarnos de brindarte la mejor experiencia.",
      googleReviewUrl: "https://g.page/r/tu-inmobiliaria/review",
      googleReviewPrompt: "Nos encantaría conocer tu opinión en Google: {link}",
      loyaltyDiscount: "Acceso prioritario a preventas antes de su publicación en portales."
    }
  },
  {
    id: "belleza_barberias",
    category: "Belleza & Cuidado Personal",
    name: "Recepcionista de Salón & Barbería",
    icon: "✂️",
    description: "Reserva de turnos por profesional, lista de precios y confirmaciones.",
    defaultSystemPrompt: "Eres el recepcionista digital del salón. Muestra el menú de servicios, consulta con qué profesional desea atenderse y confirma el turno con nombre y teléfono.",
    defaultCatalog: [
      { id: "srv_8", name: "Corte de Cabello Signature & Lavado Premium", price: 22, duration: "35 min", description: "Corte a tijera o máquina con degrade pulido, lavado y peinado con cera mate." },
      { id: "srv_9", name: "Perfilado de Barba con Toalla Caliente & Aceite", price: 18, duration: "25 min", description: "Ritual tradicional con navaja y tratamiento hidratante." },
      { id: "srv_10", name: "Colorimetría, Balayage & Nutrición Capilar", price: 120, duration: "120 min", description: "Diseño de color personalizado con productos libres de amoníaco." }
    ],
    salesFlow: {
      qualification: "¿Qué servicio buscas realizarte y tienes preferencia de estilista/barbero?",
      objections: "Si preguntan por productos, aclara que usamos exclusivamente marcas premium importadas.",
      closing: "¿Te agendamos para hoy a las 17:30 o prefieres mañana a las 11:00?"
    },
    supportFlow: {
      faqs: "Q: ¿Se puede pagar con tarjeta? R: Sí, aceptamos tarjetas de débito/crédito, transferencias y efectivo.\nQ: ¿Qué días abren? R: Martes a Sábados de 10:00 a 20:30 hs.",
      emergency: "Si necesitas reprogramar, avísanos con al menos 2 horas de anticipación."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 3,
      message: "¡Hola {nombre}! Esperamos que te haya encantado tu look de hoy. ¿Cómo calificarías el trabajo de nuestro equipo?",
      googleReviewUrl: "https://g.page/r/tu-salon/review",
      googleReviewPrompt: "¡Nos alegra mucho! ¿Nos regalas 5 estrellas en Google? {link}",
      loyaltyDiscount: "20% OFF en tu próximo servicio si agendas dentro de los 21 días."
    }
  },
  {
    id: "servicios_b2b",
    category: "Empresas & Servicios B2B",
    name: "Calificador de Clientes B2B & Ventas",
    icon: "⚖️",
    description: "Diagnóstico comercial, scoring de empresas y agendamiento en Google Meet / Zoom.",
    defaultSystemPrompt: "Eres el asesor corporativo de la empresa. Identifica las necesidades del cliente, evalúa el tamaño de la empresa y coordina una reunión estratégica por videollamada.",
    defaultCatalog: [
      { id: "srv_11", name: "Consultoría Estratégica & Diagnóstico de Procesos", price: 450, duration: "60 min", description: "Auditoría integral con reporte de optimización y reducción de costos." },
      { id: "srv_12", name: "Implementación de Software & Automatización", price: 1800, duration: "2 semanas", description: "Despliegue llave en mano con capacitación para todo tu equipo." },
      { id: "srv_13", name: "Suscripción Mensual de Soporte & Mantenimiento Pro", price: 390, duration: "Mensual", description: "Monitoreo 24/7, soporte prioritario y actualizaciones continuas." }
    ],
    salesFlow: {
      qualification: "¿Cuántas personas integran tu equipo y cuál es el principal cuello de botella que buscan resolver este mes?",
      objections: "Si evalúan el presupuesto, resalta que la solución se paga sola en el primer mes al ahorrar +20 horas semanales.",
      closing: "¿Te parece agendar una llamada de 20 minutos por Google Meet este Jueves a las 15:00 hs para mostrarte una propuesta a medida?"
    },
    supportFlow: {
      faqs: "Q: ¿Emiten factura con crédito fiscal? R: Sí, emitimos factura A/B oficial de inmediato.\nQ: ¿Tienen contrato de permanencia? R: No, el servicio es mensual sin letra chica.",
      emergency: "Canal de soporte de emergencia 24/7 disponible para clientes Pro."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 48,
      message: "Estimado/a {nombre}, ¿cómo evalúas el impacto de las soluciones implementadas en tu empresa hasta ahora?",
      googleReviewUrl: "https://g.page/r/tu-agencia/review",
      googleReviewPrompt: "Tu testimonio nos ayuda a seguir impulsando más empresas: {link}",
      loyaltyDiscount: "1 mes gratis al referir a una empresa aliada."
    }
  }
];

// Production State Helper Functions
function getStoredAgencyClients() {
  const data = localStorage.getItem('nexus_agency_clients');
  if (data) {
    try {
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }
  return [];
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

// Quotes & Invoices Storage Helpers
function getStoredQuotes() {
  const data = localStorage.getItem('nexus_agency_quotes');
  return data ? JSON.parse(data) : [];
}

function saveQuotes(quotes) {
  localStorage.setItem('nexus_agency_quotes', JSON.stringify(quotes));
}

