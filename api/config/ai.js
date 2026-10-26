const fs = require('fs');
const path = require('path');
const db = require('../db');

const AI_CONFIG_FILE = path.join(process.cwd(), 'ai_config.json');

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
      const { apiKey, model, agencyId } = payload;
      const cleanKey = apiKey !== undefined ? apiKey.trim() : '';
      const cleanModel = (model || 'gemini-1.5-flash').trim();

      // Save to ai_config.json
      try {
        fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify({ apiKey: cleanKey, model: cleanModel, updatedAt: new Date().toISOString() }, null, 2));
      } catch (e) {
        console.error('Error guardando ai_config.json:', e.message);
      }

      // Persist to Neon Postgres DB if agencyId is provided
      if (agencyId) {
        try {
          await db.query(
            `UPDATE agencies 
             SET portal_config = jsonb_set(COALESCE(portal_config, '{}'::jsonb), '{ai_key}', to_jsonb($1::text))
             WHERE id = $2`,
            [cleanKey, agencyId]
          );
        } catch (dbErr) {
          console.error('[DB Note] No se pudo guardar ai_key:', dbErr.message);
        }
      }

      // Test Key if provided
      let testSuccess = false;
      let sampleReply = '';
      if (cleanKey) {
        if (cleanKey.startsWith('sk-')) {
          // OpenAI test
          const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cleanKey}`
            },
            body: JSON.stringify({
              model: cleanModel.includes('gpt') ? cleanModel : 'gpt-4o-mini',
              messages: [{ role: 'user', content: 'Di "¡Hola! Estoy listo para atender a tus clientes."' }],
              max_tokens: 50
            })
          });
          if (oaiRes.ok) {
            const data = await oaiRes.json();
            sampleReply = data.choices?.[0]?.message?.content || 'Conexión exitosa';
            testSuccess = true;
          } else {
            const errText = await oaiRes.text();
            return res.status(400).json({ success: false, error: `Error en OpenAI: ${errText}` });
          }
        } else {
          // Google Gemini test
          const gemModel = cleanModel.includes('gemini') ? cleanModel : 'gemini-1.5-flash';
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemModel}:generateContent?key=${cleanKey}`;
          const gRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'Di "¡Hola! Estoy listo para atender a tus clientes."' }] }] })
          });
          if (gRes.ok) {
            const data = await gRes.json();
            sampleReply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Conexión exitosa con Gemini';
            testSuccess = true;
          } else {
            const errText = await gRes.text();
            return res.status(400).json({ success: false, error: `Error en Google Gemini: ${errText}` });
          }
        }
      }

      return res.status(200).json({
        success: true,
        hasKey: !!cleanKey,
        isLiveAi: testSuccess,
        activeModel: cleanModel,
        sampleReply: sampleReply.trim()
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.method === 'GET') {
    let savedKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
    let savedModel = process.env.AI_MODEL || 'gemini-1.5-flash';
    try {
      if (fs.existsSync(AI_CONFIG_FILE)) {
        const fileData = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf8'));
        if (fileData.apiKey) savedKey = fileData.apiKey;
        if (fileData.model) savedModel = fileData.model;
      }
    } catch (e) {}

    return res.status(200).json({
      hasKey: !!savedKey,
      activeModel: savedModel,
      provider: savedKey.startsWith('sk-') ? 'OpenAI' : 'Google Gemini',
      maskedKey: savedKey ? (savedKey.slice(0, 4) + '...' + savedKey.slice(-4)) : ''
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
