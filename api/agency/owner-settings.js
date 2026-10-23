const db = require('../../db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { agencyId, ownerAlertPhone, ownerAlertsEnabled } = payload;
      await db.query(
        `UPDATE agencies SET 
          owner_alert_phone = $1, 
          owner_alerts_enabled = $2 
         WHERE id = $3`,
        [ownerAlertPhone || null, ownerAlertsEnabled !== false, agencyId || 'agency_master_1']
      );
      return res.status(200).json({ success: true, message: 'Configuración de alertas actualizada.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const agencyId = req.query.agencyId || 'agency_master_1';
      const result = await db.query(
        `SELECT owner_alert_phone, owner_alerts_enabled FROM agencies WHERE id = $1 LIMIT 1`,
        [agencyId]
      );
      return res.status(200).json({
        success: true,
        data: result?.rows?.[0] || { owner_alert_phone: '', owner_alerts_enabled: true }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
