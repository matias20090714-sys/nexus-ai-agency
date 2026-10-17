const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

// Spintax processor: replaces {option1|option2|option3} with random option
function parseSpintax(text) {
  if (!text) return '';
  const spintaxRegex = /\{([^{}]+)\}/g;
  return text.replace(spintaxRegex, (match, choices) => {
    const options = choices.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

// 1. RAG Knowledge Documents Loader
async function getAgencyKnowledgeContext(agencyId) {
  try {
    const res = await db.query(
      `SELECT filename, extracted_text FROM knowledge_docs WHERE agency_id = $1 ORDER BY id DESC LIMIT 5`,
      [agencyId || 'agency_master_1']
    );
    if (!res || res.rows.length === 0) return '';
    return res.rows.map(r => `--- DOCUMENTO: ${r.filename} ---\n${r.extracted_text.slice(0, 3000)}`).join('\n\n');
  } catch (e) {
    console.error('Error cargando knowledge docs:', e.message);
    return '';
  }
}

// 2. High-Intent Lead Detector & Owner Alert
async function checkAndAlertOwner(agencyId, senderPhone, textBody, activeSock) {
  try {
    const text = (textBody || '').toLowerCase();
    const isHighIntent = 
      text.includes('contrat') || 
      text.includes('comprar') || 
      text.includes('cotiz') || 
      text.includes('transferencia') || 
      text.includes('cbu') || 
      text.includes('humano') || 
      text.includes('asesor') || 
      text.includes('interesa el plan') ||
      text.includes('link de pago');

    if (!isHighIntent) return;

    // 1. Insert/update lead in Neon DB
    await db.query(
      `INSERT INTO leads (agency_id, name, phone, status, value, source, notes)
       VALUES ($1, $2, $3, 'calificado', 290.00, 'whatsapp', $4)
       ON CONFLICT DO NOTHING`,
      [agencyId, `Lead WhatsApp +${senderPhone}`, senderPhone, `Detectado por IA: "${textBody.slice(0, 150)}"`]
    );

    // 2. Check agency owner alert phone
    const agencyRes = await db.query(
      `SELECT name, owner_alert_phone, owner_alerts_enabled FROM agencies WHERE id = $1`,
      [agencyId]
    );
    const agency = agencyRes?.rows?.[0];
    if (!agency || !agency.owner_alerts_enabled || !agency.owner_alert_phone) return;

    const alertPhone = agency.owner_alert_phone.replace(/\D/g, '');
    if (!alertPhone || alertPhone.length < 8) return;

    const alertJid = `${alertPhone}@s.whatsapp.net`;
    const alertMessage = 
      `🚨 *¡ALERTA DE LEAD CALIFICADO!* (${agency.name})\n\n` +
      `👤 *Prospecto:* +${senderPhone}\n` +
      `💬 *Mensaje Recibido:* "${textBody}"\n\n` +
      `⚡ *Acción recomendada:* Contactar de inmediato para cerrar la venta.\n` +
      `🕒 *Hora:* ${new Date().toLocaleTimeString()}`;

    if (activeSock) {
      await activeSock.sendMessage(alertJid, { text: alertMessage });
      console.log(`[Alertas] 🔔 Alerta enviada al dueño (+${alertPhone}) por lead +${senderPhone}`);
    }
  } catch (err) {
    console.error('Error al verificar y alertar al dueño:', err.message);
  }
}

// 3. Appointment Reminder Scheduler (Runs every 60 seconds)
function startAppointmentReminderCron(getActiveSock) {
  setInterval(async () => {
    try {
      const now = new Date();
      // 24h reminders (appointments happening in 23-25 hours)
      const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
      const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      const res24h = await db.query(
        `SELECT a.*, ag.name as agency_name 
         FROM appointments a
         JOIN agencies ag ON a.agency_id = ag.id
         WHERE a.status = 'confirmed' 
           AND a.reminder_24h_sent = FALSE 
           AND a.appointment_date >= $1 AND a.appointment_date <= $2`,
        [in23h.toISOString(), in25h.toISOString()]
      );

      for (const appt of (res24h?.rows || [])) {
        const sock = getActiveSock(appt.agency_id);
        if (sock) {
          const cleanPhone = appt.contact_phone.replace(/\D/g, '');
          const jid = `${cleanPhone}@s.whatsapp.net`;
          const timeStr = new Date(appt.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const msg = `👋 Hola *${appt.contact_name}*, te recordamos tu cita de *${appt.service_name || 'Atención'}* mañana a las *${timeStr} hs* con ${appt.agency_name}.\n\n¿Nos confirmas tu asistencia? (Responde *SI* para confirmar o avísanos si necesitas reprogramar). ¡Gracias!`;
          
          await sock.sendMessage(jid, { text: msg });
          await db.query(`UPDATE appointments SET reminder_24h_sent = TRUE WHERE id = $1`, [appt.id]);
          console.log(`[Recordatorios] 📲 Recordatorio 24h enviado a ${appt.contact_name} (+${cleanPhone})`);
        }
      }

      // 2h reminders (appointments happening in 1-2.5 hours)
      const in1h = new Date(now.getTime() + 1 * 60 * 60 * 1000);
      const in2_5h = new Date(now.getTime() + 2.5 * 60 * 60 * 1000);

      const res2h = await db.query(
        `SELECT a.*, ag.name as agency_name 
         FROM appointments a
         JOIN agencies ag ON a.agency_id = ag.id
         WHERE a.status = 'confirmed' 
           AND a.reminder_2h_sent = FALSE 
           AND a.appointment_date >= $1 AND a.appointment_date <= $2`,
        [in1h.toISOString(), in2_5h.toISOString()]
      );

      for (const appt of (res2h?.rows || [])) {
        const sock = getActiveSock(appt.agency_id);
        if (sock) {
          const cleanPhone = appt.contact_phone.replace(/\D/g, '');
          const jid = `${cleanPhone}@s.whatsapp.net`;
          const timeStr = new Date(appt.appointment_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const msg = `⏰ Hola *${appt.contact_name}*, tu cita de *${appt.service_name || 'Atención'}* es en menos de 2 horas (*${timeStr} hs*). Te esperamos puntual en ${appt.agency_name}. ¡Hasta pronto!`;
          
          await sock.sendMessage(jid, { text: msg });
          await db.query(`UPDATE appointments SET reminder_2h_sent = TRUE WHERE id = $1`, [appt.id]);
          console.log(`[Recordatorios] 📲 Recordatorio 2h enviado a ${appt.contact_name} (+${cleanPhone})`);
        }
      }
    } catch (e) {
      // Background reminder tick error suppressed
    }
  }, 60000);
}

// 4. Anti-Ban Broadcast Engine
const activeCampaigns = {};

async function startBroadcastExecution(campaignId, agencyId, messageTemplate, recipientsList, getActiveSock) {
  activeCampaigns[campaignId] = {
    campaignId,
    agencyId,
    total: recipientsList.length,
    sent: 0,
    failed: 0,
    status: 'running'
  };

  (async () => {
    const sock = getActiveSock(agencyId);
    for (let i = 0; i < recipientsList.length; i++) {
      if (activeCampaigns[campaignId]?.status === 'stopped') break;

      const item = recipientsList[i];
      const cleanPhone = item.phone.replace(/\D/g, '');
      const name = item.name || 'Cliente';

      try {
        // Apply Spintax and dynamic variables
        let msg = parseSpintax(messageTemplate);
        msg = msg.replace(/{nombre}/gi, name).replace(/{telefono}/gi, cleanPhone);

        if (sock && cleanPhone.length >= 8) {
          const jid = `${cleanPhone}@s.whatsapp.net`;
          await sock.sendMessage(jid, { text: msg });
          activeCampaigns[campaignId].sent++;
          await db.query(
            `UPDATE broadcast_recipients SET status = 'sent', sent_at = NOW() WHERE campaign_id = $1 AND phone = $2`,
            [campaignId, cleanPhone]
          );
        } else {
          activeCampaigns[campaignId].failed++;
        }
      } catch (err) {
        console.error(`[Broadcast] Error enviando a +${cleanPhone}:`, err.message);
        activeCampaigns[campaignId].failed++;
      }

      // Random safety anti-ban pause between 5 and 11 seconds
      if (i < recipientsList.length - 1) {
        const pauseMs = Math.floor(Math.random() * 6000) + 5000;
        await new Promise(r => setTimeout(r, pauseMs));
      }
    }

    if (activeCampaigns[campaignId]) {
      activeCampaigns[campaignId].status = 'completed';
      await db.query(
        `UPDATE broadcast_campaigns SET status = 'completed', sent_count = $1, failed_count = $2 WHERE id = $3`,
        [activeCampaigns[campaignId].sent, activeCampaigns[campaignId].failed, campaignId]
      );
    }
  })();

  return activeCampaigns[campaignId];
}

// 5. Direct Google Calendar API Event Creator
async function getGoogleCalendarAccessToken() {
  let creds = null;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } catch (e) {}
  }
  if (!creds) {
    const credsPath = path.join(__dirname, 'google-credentials.json');
    if (fs.existsSync(credsPath)) {
      try {
        creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
      } catch (e) {}
    }
  }
  if (!creds || !creds.client_email || !creds.private_key) return null;

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claimSet = Buffer.from(JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    })).toString('base64url');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(header + '.' + claimSet);
    const signature = sign.sign(creds.private_key, 'base64url');
    const jwt = header + '.' + claimSet + '.' + signature;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
    });

    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.error('Error obteniendo Google access token:', err.message);
    return null;
  }
}

async function createGoogleCalendarEvent(calendarId, { summary, description, startIso, endIso }) {
  try {
    const token = await getGoogleCalendarAccessToken();
    if (!token) return null;

    const targetCal = calendarId || 'primary';
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCal)}/events`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: startIso },
        end: { dateTime: endIso }
      })
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[Google Calendar] 📅 Evento creado con éxito en Google Calendar: ${data.htmlLink}`);
      return data;
    } else {
      const err = await res.text();
      console.log('[Google Calendar] Aviso al insertar evento:', err);
      return null;
    }
  } catch (err) {
    console.error('Error insertando evento en Google Calendar:', err.message);
    return null;
  }
}

module.exports = {
  parseSpintax,
  getAgencyKnowledgeContext,
  checkAndAlertOwner,
  startAppointmentReminderCron,
  startBroadcastExecution,
  createGoogleCalendarEvent,
  activeCampaigns
};

