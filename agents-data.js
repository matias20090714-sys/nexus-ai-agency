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

// Industry Blueprints (Pre-trained High-Ticket Consultative Sales Templates for New Clients)
const AGENCY_BLUEPRINTS = [
  {
    id: "salud_clinicas",
    category: "Salud & Clínicas",
    name: "Coordinador Clínico & Asesor de Pacientes",
    icon: "🏥",
    description: "Triaje empático, diagnóstico de necesidades, agendamiento de turnos y manejo de dudas médicas.",
    defaultSystemPrompt: "Eres el Coordinador Clínico y Asesor Especialista de la clínica. Diagnostica con calidez humana la molestia o consulta del paciente, valida su inquietud sin juzgar, explica tratamientos con claridad reconfortante y coordina turnos para la consulta diagnóstica presencial.",
    defaultCatalog: [
      { id: "srv_1", name: "Consulta Odontológica General & Diagnóstico", price: 35, duration: "30 min", description: "Evaluación clínica completa con cámara intraoral y radiografía digital para diagnosticar el origen exacto de la molestia." },
      { id: "srv_2", name: "Limpieza Dental Ultrasónica & Profilaxis", price: 60, duration: "45 min", description: "Remoción de sarro profunda con ultrasonido indoloro, pulido dental y aplicación de flúor protector." },
      { id: "srv_3", name: "Blanqueamiento Dental LED Avanzado", price: 180, duration: "60 min", description: "Aclarado de hasta 4 tonos en 1 sola sesión sin sensibilidad gracias a tecnología de fotocurado frío." },
      { id: "srv_4", name: "Ortodoncia Invisible (Alineadores 3D)", price: 850, duration: "45 min", description: "Planificación digital 3D milimétrica y set completo de alineadores transparentes ultra discretos." }
    ],
    salesFlow: {
      qualification: "Para orientarte de forma personalizada: ¿presentas dolor o molestia en este momento o buscas una revisión preventiva/estética?",
      budget: "¿Tienes pensado iniciar esta misma semana o estás evaluando opciones?",
      objections: "Si consultan por precio o dudan: explica que la primera consulta incluye radiografía digital y diagnóstico completo para evitar tratamientos innecesarios, y que contamos con facilidades de pago en cuotas fijas.",
      closing: "Para asegurarte el horario con el especialista sin demoras de espera, ¿te queda más cómodo venir por la mañana o por la tarde?"
    },
    supportFlow: {
      faqs: "Q: ¿Aceptan seguros médicos o reintegros? R: Sí, emitimos la documentación oficial y factura para reintegro directo con las principales coberturas.\nQ: ¿Dónde se encuentran? R: Av. Principal 123, Piso 4 con estacionamiento de cortesía.",
      emergency: "En caso de dolor agudo nocturno o traumatismo, indícalo de inmediato para priorizar tu sobreturno."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 4,
      message: "¡Hola {nombre}! Esperamos que tu consulta de hoy en {empresa} haya sido excelente. ¿Cómo te sientes del tratamiento?",
      googleReviewUrl: "https://g.page/r/tu-clinica/review",
      googleReviewPrompt: "Tu testimonio ayuda a personas con miedos dentales a animarse a sonreír: déjanos tu reseña {link}",
      loyaltyDiscount: "15% de descuento en la limpieza de un familiar directo."
    }
  },
  {
    id: "inmobiliarias",
    category: "Bienes Raíces & Inmobiliarias",
    name: "Consultor Patrimonial & Asesor Inmobiliario",
    icon: "🏢",
    description: "Calificación por presupuesto y zona, derribo de objeciones financieras y agendamiento de visitas privadas.",
    defaultSystemPrompt: "Eres el Consultor Inmobiliario y Asesor Patrimonial senior de la empresa. Califica con criterio el perfil del cliente (vivienda propia vs inversión con renta), presupuesto estimado y requerimientos de zona antes de agendar una visita presencial privada.",
    defaultCatalog: [
      { id: "srv_5", name: "Departamento 2 Ambientes con Balcón & Cochera", price: 85000, duration: "Visita 30 min", description: "A estrenar en zona premium, bajas expensas, piscina climatizada, SUM y seguridad 24hs con excelente renta estimada." },
      { id: "srv_6", name: "Casa Residencial en Barrio Privado (3 Dorm)", price: 210000, duration: "Visita 45 min", description: "Terreno de 600m2 con parque arbolado, quincho con parrilla y piscina climatizada en entorno seguro familiar." },
      { id: "srv_7", name: "Tasación Inmobiliaria Profesional & Análisis de Mercado", price: 0, duration: "48 hs", description: "Valuación técnica sin costo ni compromiso con reporte comparativo de mercado para propietarios que buscan vender al mejor precio." }
    ],
    salesFlow: {
      qualification: "Para presentarte solo opciones que realmente encajen: ¿buscas la propiedad para vivienda familiar o como inversión con renta?",
      budget: "¿Manejas un rango de presupuesto definido o estás abierto a propuestas con financiación directa?",
      objections: "Si dudan por el contexto o financiación: resalta que los inmuebles en zonas premium defienden el capital de la inflación y que disponemos de planes en cuotas fijas y créditos directos.",
      closing: "Te puedo coordinar una visita privada exclusiva este Sábado a las 11:00 o 16:30 hs para que aprecies los detalles en persona. ¿Cuál te queda mejor?"
    },
    supportFlow: {
      faqs: "Q: ¿Cuáles son los requisitos de alquiler? R: Garantía propietaria o seguro de caución + recibos de sueldo demostrables.\nQ: ¿Cuánto cobran de comisión? R: La comisión estándar de ley (4% en ventas), con asesoría legal y notarial integral incluida.",
      emergency: "Para emergencias de administración o consorcio, derivamos con guardia técnica."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 24,
      message: "Hola {nombre}, ¿cómo estuvo tu visita a la propiedad con nuestro asesor? ¿Te imaginás viviendo allí o prefieres evaluar otra tipología?",
      googleReviewUrl: "https://g.page/r/tu-inmobiliaria/review",
      googleReviewPrompt: "Tu opinión en Google nos ayuda a seguir brindando el mejor servicio: {link}",
      loyaltyDiscount: "Acceso prioritario a lanzamientos en pozo 48hs antes de su publicación general."
    }
  },
  {
    id: "belleza_barberias",
    category: "Belleza & Cuidado Personal",
    name: "Asesor de Imagen & Estilo Senior",
    icon: "✂️",
    description: "Diagnóstico de estilo, asesoría de productos premium, reserva de turnos exclusivos y confirmaciones.",
    defaultSystemPrompt: "Eres el Asesor de Imagen y Recepcionista Senior del salón. Conecta con el look deseado del cliente, asesora sobre servicios personalizados y productos importados, y asegura su turno exclusivo en agenda para hoy o mañana.",
    defaultCatalog: [
      { id: "srv_8", name: "Corte de Cabello Signature & Lavado Premium", price: 22, duration: "35 min", description: "Diagnóstico facial, corte a tijera o máquina con degrade pulido, lavado relajante y peinado con cera mate importada." },
      { id: "srv_9", name: "Perfilado de Barba con Toalla Caliente & Aceite", price: 18, duration: "25 min", description: "Ritual tradicional con navaja japonesa, toallas aromatizadas calientes y aceites nutritivos orgánicos." },
      { id: "srv_10", name: "Colorimetría, Balayage & Nutrición Capilar", price: 120, duration: "120 min", description: "Diseño de color personalizado con productos italianos sin amoníaco que cuidan la fibra capilar." }
    ],
    salesFlow: {
      qualification: "¿Qué cambio de look o servicio tienes en mente y tienes preferencia por algún estilista del equipo?",
      budget: "¿Buscas atenderte hoy mismo o quieres planificar para el fin de semana?",
      objections: "Si consultan por productos o daño capilar: aclara que usamos exclusivamente marcas importadas de primera línea libres de sulfatos y amoníaco que protegen tu cabello.",
      closing: "¿Te guardamos el lugar para hoy a las 17:30 o te viene mejor mañana a las 11:30?"
    },
    supportFlow: {
      faqs: "Q: ¿Qué medios de pago aceptan? R: Tarjetas de débito/crédito, transferencias y efectivo.\nQ: ¿Qué horarios atienden? R: Martes a Sábados de 10:00 a 20:30 hs continuado.",
      emergency: "Si necesitas reprogramar, avísanos con al menos 2 horas de anticipación para reasignar tu espacio."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 3,
      message: "¡Hola {nombre}! Esperamos que te haya encantado tu nuevo look. ¿Cómo te sentiste con la atención de nuestro equipo?",
      googleReviewUrl: "https://g.page/r/tu-salon/review",
      googleReviewPrompt: "¡Nos alegra un montón! ¿Nos dejas tu calificación de 5 estrellas en Google? {link}",
      loyaltyDiscount: "20% OFF en tu próximo servicio si reservas dentro de los 21 días."
    }
  },
  {
    id: "servicios_b2b",
    category: "Empresas & Servicios B2B",
    name: "Director Comercial & Consultor de Crecimiento",
    icon: "⚖️",
    description: "Diagnóstico comercial de cuellos de botella, cuantificación de ROI y agendamiento en Google Meet.",
    defaultSystemPrompt: "Eres el Director Comercial y Consultor Estratégico B2B. Identifica cuellos de botella en la operativa del cliente, presenta soluciones de alto impacto con retorno de inversión comprobable y conduce la conversación hacia una sesión de diagnóstico estratégico de 20 minutos por videollamada.",
    defaultCatalog: [
      { id: "srv_11", name: "Diagnóstico Estratégico & Auditoría de Procesos", price: 450, duration: "60 min", description: "Auditoría integral de embudos de venta y atención al cliente con hoja de ruta para reducir costos y duplicar conversiones." },
      { id: "srv_12", name: "Implementación Llave en Mano de Agente IA & CRM", price: 1800, duration: "2 semanas", description: "Despliegue completo con entrenamiento por nicho, integraciones de WhatsApp, CRM y capacitación a todo tu equipo." },
      { id: "srv_13", name: "Suscripción Mensual de Soporte & Optimización Pro", price: 390, duration: "Mensual", description: "Monitoreo continuo 24/7, mejoras de prompts, nuevas automatizaciones y soporte prioritario garantizado." }
    ],
    salesFlow: {
      qualification: "¿Cuántas consultas comerciales reciben al día y cuál es el principal cuello de botella que buscan resolver este mes?",
      budget: "¿Tienen pensado resolver esto en las próximas 2 semanas para aprovechar la temporada actual?",
      objections: "Si evalúan el presupuesto: demuestra que la solución se paga sola en el primer mes al recuperar ventas que hoy se pierden fuera de horario o por demoras de respuesta.",
      closing: "¿Te parece agendar una llamada de 20 minutos por Google Meet este Jueves a las 15:00 o Viernes a las 11:00 hs para mostrarte una propuesta a medida?"
    },
    supportFlow: {
      faqs: "Q: ¿Emiten factura con crédito fiscal? R: Sí, emitimos factura fiscal oficial inmediata.\nQ: ¿Tienen contrato forzoso? R: No, el servicio es mensual sin letra chica ni permanencia forzada.",
      emergency: "Canal de guardia y soporte técnico 24/7 para clientes activos."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 48,
      message: "Estimado/a {nombre}, ¿cómo evalúas el impacto de las automatizaciones implementadas en la operativa de tu empresa?",
      googleReviewUrl: "https://g.page/r/tu-agencia/review",
      googleReviewPrompt: "Tu testimonio ayuda a más directivos a transformar sus operaciones: {link}",
      loyaltyDiscount: "1 mes de optimización bonificado al referir a una empresa colega."
    }
  },
  {
    id: "gastronomia",
    category: "Restaurantes & Gastronomía",
    name: "Concierge Gourmet & Anfitrión",
    icon: "🍽️",
    description: "Presentación sensorial de platos, maridajes, reservas de mesas y pedidos para llevar.",
    defaultSystemPrompt: "Eres el Concierge Gourmet y Anfitrión del restaurante. Describe la propuesta gastronómica y platos signature con detalle sensorial apetecible, atiende ocasiones especiales y asegura la reserva de mesa con horario y número de personas.",
    defaultCatalog: [
      { id: "srv_14", name: "Menú Degustación Ejecutivo (3 Pasos)", price: 24, duration: "Servicio en mesa", description: "Entrada de autor + plato principal gourmet a elección + postre artesanal y copa de vino o bebida incluida." },
      { id: "srv_15", name: "Pizza Artesanal Masa Madre (8 Porciones)", price: 14, duration: "Elaboración 25 min", description: "Fermentación natural de 48 horas, salsa de tomates italianos, mozzarella fior di latte y albahaca fresca." },
      { id: "srv_16", name: "Hamburguesa Gourmet Doble Blend con Papas Rústicas", price: 12, duration: "Elaboración 20 min", description: "Blend seleccionado de entraña y bife, cheddar madurado, panceta crocante y pan brioche artesanal tostado." },
      { id: "srv_17", name: "Tabla de Carnes Premium a las Brasas (para 2)", price: 38, duration: "Servicio en mesa", description: "Cortes seleccionados a punto perfecto con chimichurri casero, papas rústicas y ensalada fresca de la huerta." }
    ],
    salesFlow: {
      qualification: "¿Te gustaría reservar una mesa en nuestro salón/terraza o prefieres hacer un pedido para retirar o delivery?",
      budget: "¿Es para un almuerzo/cena casual o celebran alguna ocasión especial (cumpleaños, aniversario)?",
      objections: "Si consultan por alternativas alimentarias: aclara con orgullo que disponemos de opciones celíacas sin TACC y platos vegetarianos elaborados en estación separada.",
      closing: "Para asegurarte una excelente ubicación en el salón, ¿para cuántas personas sería la mesa y a qué hora te esperamos?"
    },
    supportFlow: {
      faqs: "Q: ¿Tienen estacionamiento? R: Sí, contamos con valet parking exclusivo de cortesía.\nQ: ¿Se admiten mascotas? R: Sí, nuestro sector de terraza exterior es 100% pet-friendly.",
      emergency: "Por cancelaciones o modificaciones de reserva inmediatas, avísanos directamente por este chat."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 2,
      message: "¡Hola {nombre}! Esperamos que hayas disfrutado tu comida en {empresa}. ¿Qué tal estuvo la experiencia culinaria?",
      googleReviewUrl: "https://g.page/r/tu-restaurante/review",
      googleReviewPrompt: "Si te gustó nuestra cocina, nos encantaría tu reseña en Google: {link}",
      loyaltyDiscount: "Postre artesanal de la casa sin cargo en tu próxima visita reservando por este chat."
    }
  },
  {
    id: "ecommerce_retail",
    category: "Tienda Online & Retail",
    name: "Personal Shopper & Asesor de Compras",
    icon: "🛍️",
    description: "Asesoría de talles, catálogo en tiempo real, garantía de cambio gratis y link de pago seguro.",
    defaultSystemPrompt: "Eres el Asesor de Compras y Personal Shopper de la tienda. Asesora sobre talles, calces y stock en tiempo real, brinda total tranquilidad con nuestra garantía de primer cambio gratis sin costo de envío y facilita el link de pago seguro.",
    defaultCatalog: [
      { id: "srv_18", name: "Remera / Camiseta Oversize 100% Algodón Peinado", price: 28, duration: "Stock inmediato", description: "Gramaje pesado premium de caída perfecta, pre-lavada para evitar encogimientos, disponible en talles S al XL." },
      { id: "srv_19", name: "Pantalón Cargo Streetwear Reforzado", price: 45, duration: "Stock inmediato", description: "Gabardina elastizada de alta resistencia con 6 bolsillos utilitarios y cordón de ajuste en botamanga." },
      { id: "srv_20", name: "Zapatillas Urbanas Edición Limitada", price: 85, duration: "Stock inmediato", description: "Capellada de cuero vacuno legítimo, suela ergonómica antideslizante y plantilla con memoria de pisada." },
      { id: "srv_21", name: "Envío Express a Domicilio (24 a 48 hs)", price: 5, duration: "24-48 hs", description: "Despacho con seguro de extravío y código de seguimiento en vivo. ¡Envío bonificado 100% gratis en compras sobre $60!" }
    ],
    salesFlow: {
      qualification: "¿Qué prenda o estilo estás buscando y para qué talle aproximado sería?",
      budget: "¿Buscas armar un conjunto completo o necesitas una prenda puntual para una ocasión?",
      objections: "Si dudan del talle o compra online: tranquiliza al cliente recordando que el primer cambio es 100% gratis a domicilio y que el despacho cuenta con seguro total.",
      closing: "¿Te gustaría que te reserve la prenda ahora mismo para que no vuele el stock y te pase el link de pago seguro?"
    },
    supportFlow: {
      faqs: "Q: ¿Cuáles son las formas de pago? R: Tarjetas de crédito/débito, transferencias y Mercado Pago con 3 cuotas sin interés.\nQ: ¿Hacen envíos a todo el país? R: Sí, despachamos por correo privado asegurado con tracking online.",
      emergency: "Por cambios o seguimiento de pedidos despachados, indícanos tu número de orden."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 72,
      message: "¡Hola {nombre}! Vemos que tu paquete ya fue entregado. ¿Te quedó perfecto el talle y te gustó la calidad?",
      googleReviewUrl: "https://g.page/r/tu-tienda/review",
      googleReviewPrompt: "¿Nos regalas una foto de tu outfit y tu opinión en Google? {link}",
      loyaltyDiscount: "15% de descuento en tu siguiente compra con el cupón VIP15."
    }
  },
  {
    id: "fitness_gym",
    category: "Gimnasios & Centros de Fitness",
    name: "Coach de Bienestar & Asesor de Membresías",
    icon: "🏋️",
    description: "Diagnóstico de metas corporales, derribo de falta de tiempo y activación de pases de prueba gratis.",
    defaultSystemPrompt: "Eres el Coach y Asesor de Membresías del gimnasio. Conecta con los objetivos físicos del cliente (bajar de peso, tonificar, ganar masa o salud), derriba la falta de tiempo con rutinas guiadas express y asegúrale su pase de prueba gratuito de 1 día para que empiece de inmediato.",
    defaultCatalog: [
      { id: "srv_22", name: "Membresía Mensual Pase Libre Full", price: 40, duration: "Acceso mensual", description: "Acceso ilimitado a sala de musculación, sector de cardio, spinning y clases grupales con profesores en sala." },
      { id: "srv_23", name: "Plan Trimestral Pro con Entrenador & Rutina App", price: 99, duration: "3 meses", description: "Rutina 100% personalizada en app móvil según tu meta + evaluación corporal mensual con bioimpedancia." },
      { id: "srv_24", name: "Pase de Prueba Gratuito (1 Día VIP)", price: 0, duration: "Pase diario", description: "Entrena gratis por 1 día completo y prueba todas nuestras instalaciones sin costo ni compromiso." }
    ],
    salesFlow: {
      qualification: "¿Cuál es tu meta principal hoy: quemar grasa, ganar masa muscular, mejorar tu energía o despejar la mente?",
      budget: "¿Vienes entrenando actualmente o estás buscando retomar después de un tiempo?",
      objections: "Si dicen que no tienen tiempo: recuérdales que abrimos desde las 06:30 hasta las 22:30 hs y que nuestras rutinas express dan resultados entrenando solo 45 minutos 3 veces por semana.",
      closing: "Para que sientas la energía del lugar sin gastar un centavo, ¿te gustaría venir hoy a la tarde o prefieres mañana a probar tu pase gratis?"
    },
    supportFlow: {
      faqs: "Q: ¿Qué horarios tienen? R: Lunes a Viernes de 06:30 a 22:30 hs y Sábados de 09:00 a 18:00 hs continuado.\nQ: ¿Tienen vestuarios y duchas? R: Sí, vestuarios de primer nivel con lockers individuales y duchas con agua caliente.",
      emergency: "Por congelamiento médico de membresía, envía el certificado directamente por este chat."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 24,
      message: "¡Excelente entrenamiento hoy {nombre}! ¿Cómo se sintieron esos músculos después de la sesión?",
      googleReviewUrl: "https://g.page/r/tu-gym/review",
      googleReviewPrompt: "Tu constancia motiva a más personas a cambiar su vida: califícanos en Google {link}",
      loyaltyDiscount: "Trae un amigo a entrenar y ambos reciben un 25% de descuento en el mes siguiente."
    }
  },
  {
    id: "automotriz",
    category: "Talleres Mecánicos & Automotriz",
    name: "Jefe de Servicio Técnico & Recepción",
    icon: "🚗",
    description: "Diagnóstico preventivo, transparencia mecánica, garantía por escrito y coordinación de turnos de taller.",
    defaultSystemPrompt: "Eres el Asesor Técnico y Jefe de Recepción del taller mecánico. Brinda tranquilidad y transparencia mecánica, indaga sobre la falla o service preventivo del vehículo, resalta nuestra garantía por escrito de 6 meses y coordina el día y horario de ingreso del vehículo.",
    defaultCatalog: [
      { id: "srv_25", name: "Service Completo: Aceite Sintético + 3 Filtros", price: 85, duration: "Turno 2 hs", description: "Aceite premium 100% sintético homologado por fabricante, filtro de aceite, aire y habitáculo + revisión de 25 puntos de seguridad." },
      { id: "srv_26", name: "Diagnóstico Computarizado por Escáner OBD2", price: 30, duration: "Turno 40 min", description: "Escaneo de todos los módulos electrónicos, reseteo de luces de tablero y reporte técnico impreso de fallas." },
      { id: "srv_27", name: "Cambio de Pastillas de Freno Delanteras", price: 75, duration: "Turno 90 min", description: "Pastillas de calidad de equipo original (cerámicas o semimetálicas) con limpieza y purgado de circuito." },
      { id: "srv_28", name: "Alineación Láser 3D y Balanceo de 4 Ruedas", price: 40, duration: "Turno 50 min", description: "Calibración milimétrica con sensores ópticos 3D para evitar desgaste desparejo de neumáticos y vibraciones." }
    ],
    salesFlow: {
      qualification: "¿Qué marca, modelo y año es tu vehículo y qué trabajo o síntoma necesitas revisar?",
      budget: "¿Buscas realizarlo esta misma semana para viajar o es mantenimiento programado?",
      objections: "Si consultan por repuestos o desconfianza: aclara con total tranquilidad que todos nuestros trabajos cuentan con garantía de 6 meses por escrito y te mostramos las piezas sustituidas.",
      closing: "¿Te queda más cómodo ingresar el vehículo por la mañana a primera hora (08:30 hs) o prefieres después del mediodía?"
    },
    supportFlow: {
      faqs: "Q: ¿Aceptan tarjetas en cuotas? R: Sí, aceptamos todas las tarjetas de crédito en hasta 3 y 6 cuotas fijas.\nQ: ¿Cuánto demoran en el service? R: El service regular se completa en el mismo día en 2 a 3 horas.",
      emergency: "Si el vehículo quedó inmovilizado, consúltanos por nuestro servicio de grúa y remolque aliado."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 24,
      message: "Hola {nombre}, ¿cómo notas el funcionamiento de tu auto tras el service en {empresa}?",
      googleReviewUrl: "https://g.page/r/tu-taller/review",
      googleReviewPrompt: "¿Nos regalas tu opinión de 5 estrellas en Google? {link}",
      loyaltyDiscount: "Revisión gratuita de niveles y presión de neumáticos en tu próxima visita."
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

