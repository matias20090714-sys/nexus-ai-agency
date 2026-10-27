const db = require('../../db');
const fs = require('fs');
const path = require('path');
const PORTALS_FILE = path.join(process.cwd(), 'agency_portals.json');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const identifier = req.query.id || req.query.slug || req.query.agency || 'agency_master_1';

    let localEntry = null;
    try {
      if (fs.existsSync(PORTALS_FILE)) {
        const portals = JSON.parse(fs.readFileSync(PORTALS_FILE, 'utf8'));
        localEntry = portals[identifier] || portals['agency_master_1'] || Object.values(portals)[0];
      }
    } catch (e) {}

    let agencyData = null;
    try {
      const agencyRes = await db.query(
        `SELECT id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id, portal_title, portal_subtitle, portal_config FROM agencies WHERE id = $1 OR slug = $1 LIMIT 1`,
        [identifier]
      );
      agencyData = agencyRes?.rows?.[0];
      if (!agencyData) {
        const fallbackRes = await db.query(
          `SELECT id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id, portal_title, portal_subtitle, portal_config FROM agencies ORDER BY created_at ASC LIMIT 1`
        );
        agencyData = fallbackRes?.rows?.[0];
      }
    } catch (dbErr) {
      // Fallback
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

    let returnPlans = [];
    try {
      const plansRes = await db.query(
        `SELECT id, name, price, currency, period, category, features, payment_link, is_featured FROM plans WHERE agency_id = $1 ORDER BY price ASC`,
        [agencyData.id]
      );
      if (plansRes?.rows && plansRes.rows.length > 0) {
        returnPlans = plansRes.rows;
      }
    } catch (e) {}

    if (returnPlans.length === 0 && localEntry?.plans && Array.isArray(localEntry.plans) && localEntry.plans.length > 0) {
      returnPlans = localEntry.plans;
    }

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

    return res.status(200).json({
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
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
