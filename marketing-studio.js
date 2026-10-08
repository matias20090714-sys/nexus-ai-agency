// NEXUS AI - Marketing & Copywriting Automation Engine for Businesses

const MARKETING_TEMPLATES = {
  ads: {
    title: "Anuncios Meta & Google Ads (High-Conversion)",
    generate: (businessName, niche, offer, audience) => {
      return {
        headline: `🔥 ¿Cansado de perder clientes por no responder a tiempo? Descubre la solución que duplica tus ventas en ${businessName}`,
        primaryText: `En ${businessName} sabemos que el 70% de los clientes compran en el primer lugar que les contesta de inmediato.\n\n✨ Con nuestra nueva atención inteligente 24/7:\n✅ Respuestas instantáneas en menos de 3 segundos por WhatsApp.\n✅ Agendamiento automático de citas y cotizaciones personalizadas.\n✅ Oferta especial de este mes: ${offer || "Prueba piloto 100% personalizada con garantía"}.\n\n👇 ¡Toca el botón abajo y recibe una demostración interactiva ahora mismo!`,
        callToAction: "Enviar Mensaje por WhatsApp",
        targetAdvice: `Audiencia recomendada: Segmentar por ${audience || "dueños de negocios locales, gerentes comerciales y profesionales de 28 a 55 años"} en tu ciudad con interés en innovación y servicios premium.`
      };
    }
  },
  reels: {
    title: "Guión Viral para Reels / TikTok / Shorts (Retención 90%+)",
    generate: (businessName, niche, benefit) => {
      return {
        hook1: `🎣 Gancho visual (0-3s): "El error #1 que hace que ${businessName || "tu negocio"} pierda el 50% de sus clientes potenciales sin darse cuenta..."`,
        hook2: `🎣 Gancho alternativo: "Si tienes un negocio en 2026 y todavía respondes los mensajes a mano, mira este video..."`,
        body: `🎥 Desarrollo (3-20s): Muestra la pantalla del teléfono recibiendo 10 mensajes seguidos. \nVoz en off: "La mayoría de las empresas tardan entre 2 y 4 horas en responder. Para ese momento, el cliente ya le compró a la competencia. \nImplementamos un Agente de IA entrenado a medida que califica al cliente, responde dudas exactas y agenda el turno en el calendario en segundos."`,
        cta: `🚀 Cierre & CTA (20-30s): "Comenta la palabra 'AUTOMATIZAR' y te enviamos la guía paso a paso con una demo exclusiva para tu rubro."`
      };
    }
  },
  cold_email: {
    title: "Email B2B de Prospección Fría (Respuesta Alta)",
    generate: (targetName, companyName, niche) => {
      return {
        subject: `Idea rápida para duplicar las citas en ${companyName || "tu empresa"} (sin contratar más personal)`,
        body: `Hola ${targetName || "Director / Gerente"},\n\nEstuve revisando la presencia digital de ${companyName || "su empresa"} y me llamó la atención el gran volumen de demanda que tienen en su sector.\n\nSin embargo, notamos que fuera del horario comercial (o durante picos de atención), muchos clientes potenciales escriben por WhatsApp o redes y terminan cotizando con la competencia debido al tiempo de espera.\n\nEn Nexus AI desarrollamos Agentes Inteligentes autónomos para ${niche || "empresas de su rubro"} que:\n1. Atienden y responden dudas técnicas en 2 segundos.\n2. Califican el presupuesto del interesado.\n3. Agendan la cita directamente en la agenda de sus especialistas.\n\n¿Tendrías 10 minutos este jueves o viernes para mostrarte una demo rápida personalizada con el logo de ${companyName}? Sin ningún compromiso.\n\nUn saludo cordial,\nEquipo de Automatización Nexus AI`
      };
    }
  },
  whatsapp_broadcast: {
    title: "Campaña Masiva de WhatsApp (Anti-Spam & Alta Apertura)",
    generate: (businessName, promoDetails, urgency) => {
      return {
        message: `¡Hola [Nombre]! 👋\n\nEsperamos que estés teniendo una excelente semana en *${businessName || "nuestra comunidad"}* ✨\n\nQueremos premiar tu preferencia con un beneficio exclusivo disponible por tiempo limitado 🎁:\n\n🔥 *${promoDetails || "25% OFF en tu próximo servicio o tratamiento"}*\n⏳ *Válido únicamente hasta:* ${urgency || "este domingo a las 23:59 hs"}\n\n👉 Para asegurar tu lugar y consultar los horarios disponibles, *responde a este mensaje con la palabra 'QUIERO'* y nuestro asistente te asignará el turno prioritario en 10 segundos.\n\n¡Te esperamos!`
      };
    }
  },
  google_reviews: {
    title: "Generador de Respuestas a Reseñas de Google Maps",
    generate: (clientName, rating, reviewText) => {
      if (rating >= 4) {
        return {
          response: `¡Muchísimas gracias por tus amables palabras y por calificarnos con ${rating} estrellas, ${clientName || "estimado cliente"}! ⭐⭐⭐⭐⭐ En nuestro equipo nos apasiona brindar un servicio impecable y personalizado. Nos alegra enormemente saber que tu experiencia fue excelente. ¡Será un verdadero placer recibirte nuevamente muy pronto!`
        };
      } else {
        return {
          response: `Estimado/a ${clientName || "cliente"}, lamentamos sinceramente que tu experiencia no haya estado a la altura de nuestros estándares de calidad habituales. Para nosotros tu opinión es fundamental. Nos gustaría ponernos en contacto directo contigo para resolver cualquier inconveniente y ofrecerte una solución a medida. Por favor escríbenos directamente a nuestro WhatsApp de atención prioritaria para atenderte de forma personalizada.`
        };
      }
    }
  }
};
