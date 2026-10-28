const fs = require('fs');
const path = require('path');
const db = require('../db');

const COMPANIES_FILE = path.join(process.cwd(), 'companies_agents.json');

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
      const { agencyId, clients } = payload;
      const agId = agencyId || 'agency_master_1';
      const cleanClients = (Array.isArray(clients) ? clients : []).filter(c => c && c.id !== 'client_dental_1' && c.id !== 'client_resto_1' && !c.name?.includes('San Lucas') && !c.name?.includes('Bistro Gourmet'));

      let memory = {};
      try {
        if (fs.existsSync(COMPANIES_FILE)) {
          memory = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
        }
      } catch (e) {}

      memory[agId] = cleanClients;

      try {
        fs.writeFileSync(COMPANIES_FILE, JSON.stringify(memory, null, 2));
      } catch (e) {
        console.error('Error writing companies_agents.json:', e.message);
      }

      if (db) {
        for (const c of cleanClients) {
          try {
            await db.query(
              `INSERT INTO clients (id, agency_id, name, industry, phone, notes)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (id) DO UPDATE SET 
                 name = EXCLUDED.name,
                 industry = EXCLUDED.industry,
                 phone = EXCLUDED.phone,
                 notes = EXCLUDED.notes`,
              [
                c.id, 
                agId, 
                c.name, 
                c.industry || 'Servicios', 
                c.phone || null, 
                JSON.stringify({ 
                  agentName: c.agentName, 
                  systemPrompt: c.systemPrompt, 
                  knowledgeBase: c.knowledgeBase, 
                  catalog: c.catalog, 
                  salesFlow: c.salesFlow,
                  supportFlow: c.supportFlow,
                  afterSalesFlow: c.afterSalesFlow 
                })
              ]
            );
          } catch (cErr) {}
        }
      }

      return res.status(200).json({ success: true, count: cleanClients.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.method === 'GET') {
    try {
      const agencyId = req.query.agencyId || 'agency_master_1';
      let memory = {};
      try {
        if (fs.existsSync(COMPANIES_FILE)) {
          memory = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf8'));
        }
      } catch (e) {}
      const rawClients = memory[agencyId] || memory['agency_master_1'] || [];
      const clients = (Array.isArray(rawClients) ? rawClients : []).filter(c => c && c.id !== 'client_dental_1' && c.id !== 'client_resto_1' && !c.name?.includes('San Lucas') && !c.name?.includes('Bistro Gourmet'));
      return res.status(200).json({ success: true, clients });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
