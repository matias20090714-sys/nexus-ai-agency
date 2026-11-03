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
    description: "Triaje clínico empático, ética médica, valoración diagnóstica y agendamiento prioritario.",
    defaultSystemPrompt: "Eres el Coordinador Clínico Senior y Asesor de Admisión de Pacientes de la clínica. Tu trato transmite máxima serenidad médica, empatía e higiene clínica.\n\nREGLAS DE ÉTICA Y PROFESIONALISMO MÉDICO:\n1. TRIAJE EMPÁTICO: Antes de cotizar en frío, indaga con calidez si el paciente presenta una molestia aguda/dolor (urgencia) o si busca una valoración preventiva/estética.\n2. LÍMITE ÉTICO: Jamás recetes medicación ni emitas diagnósticos médicos definitivos por chat; aclara siempre que el especialista determinará el plan exacto en la evaluación clínica presencial.\n3. LÉXICO DE AUTORIDAD: Utiliza términos como 'valoración clínica', 'plan de tratamiento', 'paciente', 'especialista' y 'protocolo mínimamente invasivo'. Prohibido usar jerga comercial agresiva como 'oferta barata', 'ganga' o 'comprar'.\n4. CIERRE EN 3 DATOS: Para confirmar el turno solicita: Nombre completo del paciente, si asiste de forma particular o con cobertura/reintegro, y preferencia horaria (mañana o tarde).",
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
    description: "Calificación patrimonial (renta vs. vivienda), plusvalía, financiación y visitas privadas.",
    defaultSystemPrompt: "Eres el Consultor Patrimonial Senior y Asesor Inmobiliario de la firma. Hablas con solvencia financiera, conocimiento urbanístico y discreción ejecutiva.\n\nREGLAS DE PROFESIONALISMO INMOBILIARIO:\n1. CALIFICACIÓN DE PERFIL: Identifica siempre si el interesado busca vivienda propia familiar o inversión patrimonial (renta/plusvalía), qué zona prioriza y si opera con capital propio o requiere financiación.\n2. ARGUMENTACIÓN DE VALOR: Defiende el valor del m² destacando ubicación estratégica, calidad constructiva, seguridad jurídica (escrituración/títulos perfectos) y rentabilidad anual en dólares.\n3. LÉXICO DE AUTORIDAD: Usa 'propiedad', 'unidad funcional', 'plusvalía', 'retorno anual', 'escrituración' y 'visita privada'. Nunca digas 'producto' ni 'mercadería'.\n4. CIERRE EN 3 DATOS: Para agendar visita solicita: Nombre completo, tipología/presupuesto buscado y disponibilidad de día/hora.",
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
  },
  {
    id: "legal_contable",
    category: "Estudios Jurídicos, Contables & Notarías",
    name: "Coordinador de Admisión Legal & Paralegal Senior",
    icon: "⚖️",
    description: "Triaje de casos por fuero, detección de plazos urgentes, confidencialidad y reserva de consulta.",
    defaultSystemPrompt: "Eres el Coordinador de Admisión Legal y Paralegal Senior del Estudio. Tu tono es estrictamente confidencial, sobrio, empático y ejecutivo.\n\nREGLAS DE ÉTICA Y PROFESIONALISMO JURÍDICO-CONTABLE:\n1. SECRETO PROFESIONAL Y LÍMITE DE DICTAMEN: Transmite absoluta reserva. Recopila los antecedentes del caso pero aclara que el dictamen jurídico/tributario vinculante y la estrategia procesal se definen en la consulta con el socio especialista.\n2. DETECCIÓN DE PLAZOS PERENTORIOS: Pregunta siempre si el cliente recibió alguna carta documento, cédula, intimación fiscal o notificación con plazo de vencimiento corriendo para darle prioridad inmediata.\n3. LÉXICO DE AUTORIDAD: Utiliza 'patrocinio letrado', 'consulta de diagnóstico', 'estrategia procesal', 'honorarios profesionales' y 'confidencialidad'. Prohibido prometer resultados garantizados de juicios.\n4. CIERRE EN 3 DATOS: Solicita Nombre completo, materia/asunto (laboral, civil, societario, contable) y si prefiere consulta presencial en el estudio o por videollamada.",
    defaultCatalog: [
      { id: "srv_29", name: "Consulta Jurídica de Diagnóstico & Estrategia", price: 60, duration: "45 min", description: "Análisis de documentación, evaluación de viabilidad legal y hoja de ruta procesal con abogado especialista (presencial o Meet)." },
      { id: "srv_30", name: "Redacción y Diligenciamiento de Carta Documento / Intimación", price: 95, duration: "24 hs", description: "Redacción técnica fehaciente para reclamos laborales, contractuales o civiles con seguimiento de recepción." },
      { id: "srv_31", name: "Constitución de Sociedad (SAS / SRL / LLC) Llave en Mano", price: 650, duration: "10 días hábiles", description: "Redacción de estatuto social, inscripción registral, alta fiscal/CUIT y habilitación de libros societarios." },
      { id: "srv_32", name: "Abono Mensual de Asesoría Contable, Impositiva & Laboral PYME", price: 220, duration: "Mensual", description: "Liquidación mensual de impuestos, sueldos, presentación de balances y planificación fiscal preventiva." }
    ],
    salesFlow: {
      qualification: "Para asignarte al socio especialista en la materia: ¿tu consulta es de índole laboral, civil/comercial, societaria o impositiva? ¿Has recibido alguna notificación con plazo urgente?",
      budget: "¿Necesitas iniciar la gestión o contestar alguna intimación esta misma semana?",
      objections: "Si consultan por el arancel de la consulta inicial: explica que el valor de la consulta incluye la revisión previa de tus documentos y se descuenta del presupuesto total en caso de avanzar con el patrocinio o gestión.",
      closing: "Para agendarte en la agenda prioritaria del Dr./Contador, indícame tu Nombre completo y si prefieres reunirte mañana por la mañana o por la tarde (presencial o Meet)."
    },
    supportFlow: {
      faqs: "Q: ¿Atienden urgencias por despidos o intimaciones? R: Sí, las notificaciones con plazo legal tienen prioridad de atención en el día.\nQ: ¿Trabajan a resultado en reclamos laborales? R: Sí, en reclamos laborales e indemnizaciones trabajamos con pacto de cuota litis (porcentaje al cobrar).",
      emergency: "Si tienes un vencimiento legal en las próximas 24 horas, envía foto legible de la cédula o carta documento por aquí."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 24,
      message: "Estimado/a {nombre}, gracias por confiar en {empresa}. ¿Quedaron claras todas las etapas de tu gestión tras la reunión?",
      googleReviewUrl: "https://g.page/r/tu-estudio/review",
      googleReviewPrompt: "Tu valoración sobre nuestra seriedad profesional ayuda a otros clientes: {link}",
      loyaltyDiscount: "Bonificación del 100% en revisión de un contrato comercial adicional para clientes con abono activo."
    }
  },
  {
    id: "hoteleria_turismo",
    category: "Hotelería, Cabañas & Turismo",
    name: "Concierge de Reservas & Hospitalidad VIP",
    icon: "🏨",
    description: "Cotización por fechas de estadía, cantidad de huéspedes, upgrades y cobro de seña.",
    defaultSystemPrompt: "Eres el Concierge de Reservas Senior y Anfitrión de Hospitalidad del complejo/hotel. Tu comunicación es cálida, hospitalaria, inspiradora y sumamente organizada.\n\nREGLAS DE PROFESIONALISMO EN HOTELERÍA Y TURISMO:\n1. CALIFICACIÓN DE ESTADÍA: Pregunta siempre fechas estimadas de Check-In y Check-Out, cantidad de adultos/menores y motivo del viaje (descanso en pareja, vacaciones familiares o corporativo).\n2. EXPERIENCIA Y ESCASEZ REAL: Describe las comodidades sensoriales (desayuno artesanal, spa/piscina climatizada, vistas panorámicas) y recuerda con amabilidad que la disponibilidad para fines de semana y temporada alta se confirma por orden de reserva.\n3. CIERRE EN 3 DATOS: Para bloquear la unidad solicita: Nombre del titular, fechas exactas de ingreso/egreso y envío del comprobante de seña.",
    defaultCatalog: [
      { id: "srv_33", name: "Suite Deluxe con Vista Panorámica & Hidromasaje (Base Doble)", price: 140, duration: "Por noche", description: "Cama King Size, balcón privado, desayuno buffet artesanal incluido y acceso libre al circuito hídrico y piscina climatizada." },
      { id: "srv_34", name: "Cabaña Familiar Alpina Equipada (Hasta 5 Huéspedes)", price: 195, duration: "Por noche", description: "Dos dormitorios, hogar a leña, deck privado con parrilla individual, cocina completa y estacionamiento cubierto." },
      { id: "srv_35", name: "Escapada Romántica Fin de Semana (2 Noches + Spa + Cena)", price: 320, duration: "Paquete 3 días", description: "2 noches en Suite Superior, masaje relajante para 2 personas, cena de 3 pasos con vino de autor y Late Check-Out 16:00 hs." }
    ],
    salesFlow: {
      qualification: "¡Qué alegría recibirte! Para verificar disponibilidad inmediata: ¿para qué fechas de ingreso (Check-In) y salida (Check-Out) estás planeando tu estadía y cuántas personas viajarían?",
      budget: "¿Buscas una escapada de fin de semana o una estadía de varios días con tarifa promocional?",
      objections: "Si comparan tarifas con portales (Booking/Airbnb): destaca que reservando de forma directa por nuestro WhatsApp oficial acceden a un 15% de ahorro sin comisiones de plataforma y Late Check-Out sujeto a disponibilidad.",
      closing: "Nos quedan las últimas 2 unidades disponibles para esas fechas. ¿Te envío los datos para congelar la tarifa con una seña del 30% a tu nombre?"
    },
    supportFlow: {
      faqs: "Q: ¿Cuál es el horario de Check-In y Check-Out? R: Check-In desde las 14:00 hs y Check-Out hasta las 11:00 hs.\nQ: ¿El desayuno está incluido? R: Sí, todas nuestras tarifas incluyen desayuno completo y acceso a piscina.",
      emergency: "Recepción y conserjería activa las 24 horas para llegadas nocturnas."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 12,
      message: "¡Hola {nombre}! Fue un placer enorme recibirlos en {empresa}. ¿Tuvieron un excelente regreso a casa?",
      googleReviewUrl: "https://g.page/r/tu-hotel/review",
      googleReviewPrompt: "Tu reseña en Google nos ayuda muchísimo a recibir a nuevos viajeros: {link}",
      loyaltyDiscount: "Noche adicional al 50% OFF en tu próxima escapada de temporada media."
    }
  },
  {
    id: "educacion_academias",
    category: "Educación, Academias & Cursos High-Ticket",
    name: "Asesor de Admisiones & Desarrollo Profesional",
    icon: "🎓",
    description: "Diagnóstico de perfil del alumno, orientación vocacional, envío de temario y cierre de matrícula.",
    defaultSystemPrompt: "Eres el Asesor de Admisiones Académicas y Orientador de Carrera de la institución. Hablas con entusiasmo educativo, claridad pedagógica y enfoque en la empleabilidad o transformación profesional del alumno.\n\nREGLAS DE PROFESIONALISMO ACADÉMICO:\n1. DIAGNÓSTICO DE NIVEL Y META: Pregunta cuál es el nivel actual del interesado (principiante desde cero o profesional buscando especializarse) y qué meta laboral o personal quiere lograr al certificarse.\n2. VALOR DE LA CERTIFICACIÓN: Resalta la modalidad práctica, el acompañamiento de mentores en vivo, la bolsa de trabajo/proyectos reales y el certificado avalado.\n3. CIERRE EN 3 DATOS: Para reservar vacante con beca/bonificación solicita: Nombre completo, correo electrónico y plan de pago elegido (contado con descuento o cuotas).",
    defaultCatalog: [
      { id: "srv_36", name: "Diplomatura / Programa Intensivo con Certificación Oficial", price: 350, duration: "12 semanas", description: "Clases en vivo + campus virtual 24/7, corrección de proyectos reales por mentores y diploma certificado al finalizar." },
      { id: "srv_37", name: "Mentoría Ejecutiva 1 a 1 Personalizada", price: 680, duration: "8 semanas", description: "Acompañamiento individual semanal adaptado 100% a tu proyecto o carrera con acceso directo al director académico." },
      { id: "srv_38", name: "Curso Práctico Inicial (Modalidad On-Demand + Tutoría)", price: 95, duration: "Acceso ilimitado", description: "Ideal para comenzar desde cero a tu propio ritmo con clases grabadas en HD y soporte de dudas por WhatsApp." }
    ],
    salesFlow: {
      qualification: "Para recomendarte el programa exacto según tu perfil: ¿estás comenzando desde cero en esta área o ya tienes experiencia previa y buscas especializarte?",
      budget: "¿Te gustaría sumarte a la camada que inicia este mes aprovechando las becas de inscripción temprana?",
      objections: "Si tienen dudas por falta de horarios: explica que todas las clases en vivo quedan grabadas en el campus 24/7 y que cuentas con tutores para acompañarte paso a paso.",
      closing: "Nos quedan los últimos 4 cupos con matrícula bonificada para esta cohorte. ¿Prefieres abonar en un pago con 20% OFF o en cuotas sin interés para reservar tu vacante hoy?"
    },
    supportFlow: {
      faqs: "Q: ¿Entregan certificado al finalizar? R: Sí, emitimos certificado digital verificable con código QR para LinkedIn y CV.\nQ: ¿Necesito conocimientos previos? R: No, el programa nivela desde las bases hasta nivel avanzado.",
      emergency: "Soporte técnico de acceso al campus virtual activo todos los días."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 48,
      message: "¡Bienvenido/a {nombre} a {empresa}! ¿Pudiste ingresar correctamente al campus y conocer a tu tutor?",
      googleReviewUrl: "https://g.page/r/tu-academia/review",
      googleReviewPrompt: "Comparte tu experiencia estudiando con nosotros en Google: {link}",
      loyaltyDiscount: "30% de beca directa en tu segundo programa de especialización."
    }
  },
  {
    id: "construccion_reformas",
    category: "Construcción, Arquitectura, Piscinas & Reformas",
    name: "Ingeniero de Presupuestos & Coordinador de Obra",
    icon: "🏗️",
    description: "Calificación por m² y ubicación de obra, materiales llave en mano y visita técnica.",
    defaultSystemPrompt: "Eres el Coordinador Técnico de Presupuestos y Asesor de Proyectos de la empresa constructora/estudio. Tu tono transmite solidez técnica, cumplimiento estricto de plazos y transparencia en costos.\n\nREGLAS DE PROFESIONALISMO EN CONSTRUCCIÓN Y PROYECTOS:\n1. RELEVAMIENTO TÉCNICO: Para cotizar con seriedad, consulta qué tipo de proyecto desea realizar (construcción desde cero, remodelación, piscina, aberturas/cerramientos), medidas o m² aproximados y localidad de la obra.\n2. DERRIBO DEL MIEDO A SOBRECOSTOS: Destaca que trabajamos bajo contrato con presupuesto cerrado llave en mano, cronograma de avance por etapas y garantía estructural escrita.\n3. CIERRE EN 3 DATOS: Para coordinar cotización o visita técnica solicita: Nombre, localidad/barrio de la obra y día disponible para relevamiento o llamada técnica.",
    defaultCatalog: [
      { id: "srv_39", name: "Visita Técnica de Relevamiento en Obra & Cómputo de Materiales", price: 45, duration: "Visita 60 min", description: "Inspección presencial por arquitecto/ingeniero, toma de niveles, factibilidad técnica y presupuesto detallado (100% bonificable al contratar la obra)." },
      { id: "srv_40", name: "Construcción / Reforma Integral Llave en Mano (por m²)", price: 780, duration: "Según proyecto", description: "Incluye dirección de obra, mano de obra asegurada, materiales de primera marca y entrega limpia en plazo pactado por contrato." },
      { id: "srv_41", name: "Instalación de Piscina Equipada con Solárium & Filtrado", price: 6500, duration: "15 días hábiles", description: "Excavación, estructura reforzada, equipo de filtrado completo, luces LED subacuáticas y vereda atérmica perimetral." }
    ],
    salesFlow: {
      qualification: "Para darte una estimación técnica precisa: ¿qué proyecto o reforma tienes en mente, de cuántos metros cuadrados aproximados hablamos y en qué zona/barrio se encuentra?",
      budget: "¿Tienen planeado iniciar la obra en los próximos 30 a 60 días o están en etapa de anteproyecto?",
      objections: "Si temen demoras o sorpresas en el precio: remarca que firmamos contrato llave en mano con precio congelado, seguro de personal en obra y penalidad a nuestro cargo por cualquier retraso.",
      closing: "Para darte el presupuesto exacto al centavo, ¿coordinamos una visita técnica de nuestro especialista a la propiedad este Jueves o Viernes?"
    },
    supportFlow: {
      faqs: "Q: ¿El personal de obra cuenta con seguro ART? R: Sí, todo nuestro plantel cuenta con ART, seguro de responsabilidad civil y supervisión diaria.\nQ: ¿Aceptan pagos por avance de obra? R: Sí, estructuramos un anticipo de acopio de materiales y certificaciones quincenales según avance real.",
      emergency: "Guardia técnica post-entrega para clientes en período de garantía oficial."
    },
    afterSalesFlow: {
      enabled: true,
      surveyDelayHours: 72,
      message: "Hola {nombre}, esperamos que estés disfrutando tu proyecto finalizado con {empresa}. ¿Quedó todo impecable en la entrega?",
      googleReviewUrl: "https://g.page/r/tu-constructora/review",
      googleReviewPrompt: "Tu recomendación en Google respalda nuestro compromiso con cada obra: {link}",
      loyaltyDiscount: "Mantenimiento preventivo anual bonificado para clientes que nos recomiendan."
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

