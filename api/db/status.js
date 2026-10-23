const db = require('../../db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const isConnected = !!db.getDbPool();
    if (isConnected) {
      const u = await db.query('SELECT COUNT(*) FROM users');
      const a = await db.query('SELECT COUNT(*) FROM agencies');
      const c = await db.query('SELECT COUNT(*) FROM clients');
      const p = await db.query('SELECT COUNT(*) FROM plans');
      return res.status(200).json({
        status: 'online',
        database: 'Neon PostgreSQL (Connected)',
        metrics: {
          users: parseInt(u?.rows?.[0]?.count || 0),
          agencies: parseInt(a?.rows?.[0]?.count || 0),
          clients: parseInt(c?.rows?.[0]?.count || 0),
          plans: parseInt(p?.rows?.[0]?.count || 0)
        }
      });
    } else {
      return res.status(500).json({ status: 'offline', error: 'No database pool available' });
    }
  } catch (err) {
    return res.status(500).json({ status: 'error', error: err.message });
  }
};
