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
    const { email, password } = payload;
    const userRes = await db.query(
      `SELECT u.id, u.agency_id, u.name, u.email, u.role, a.name as agency_name, a.brand_color 
       FROM users u 
       LEFT JOIN agencies a ON u.agency_id = a.id 
       WHERE u.email = $1 AND u.password_hash = $2`,
      [email, password]
    );
    if (!userRes || userRes.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciales inválidas. Verifica tu correo y contraseña.' });
    }
    return res.status(200).json({ success: true, user: userRes.rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
