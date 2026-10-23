const db = require('../../db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { name, email, password, agencyName } = payload;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Nombre, email y contraseña son obligatorios.' });
    }
    const agencyId = 'ag_' + Date.now();
    const aName = agencyName || `${name} Agency`;
    const slug = aName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    await db.query(
      `INSERT INTO agencies (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [agencyId, aName, slug]
    );

    const userRes = await db.query(
      `INSERT INTO users (agency_id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, agency_id, name, email, role, created_at`,
      [agencyId, name, email, password, 'agency_admin']
    );

    return res.status(200).json({ success: true, user: userRes?.rows?.[0] || { name, email, agency_id: agencyId } });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
};
