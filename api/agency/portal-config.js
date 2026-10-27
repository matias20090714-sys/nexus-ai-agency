const db = require('../../db');
const fs = require('fs');
const path = require('path');
const PORTALS_FILE = path.join(process.cwd(), 'agency_portals.json');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
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

    // Save to disk agency_portals.json
    try {
      let portals = {};
      if (fs.existsSync(PORTALS_FILE)) {
        portals = JSON.parse(fs.readFileSync(PORTALS_FILE, 'utf8'));
      }
      const agencyObj = {
        id: agId,
        name: name || 'Mi Agencia',
        slug: sanitizedSlug || portals[agId]?.agency?.slug || 'nexus-ai',
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
      portals[agId] = {
        agency: agencyObj,
        plans: Array.isArray(plans) && plans.length > 0 ? plans : (portals[agId]?.plans || [])
      };
      if (sanitizedSlug) portals[sanitizedSlug] = portals[agId];
      fs.writeFileSync(PORTALS_FILE, JSON.stringify(portals, null, 2));
    } catch (diskErr) {
      console.warn('Error guardando en disco portal-config:', diskErr.message);
    }

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

    let realAgencyRow = updatedAgency?.rows?.[0];
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

    return res.status(200).json({
      success: true,
      message: '¡Landing page y configuración de marca actualizadas en vivo!',
      agency: realAgencyRow
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
