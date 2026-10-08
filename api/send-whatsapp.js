const https = require('https');

let META_TOKEN = process.env.META_TOKEN || 'META_TOKEN_PLACEHOLDER';
let META_PHONE_ID = process.env.META_PHONE_ID || '1342311562300304';

function sendMetaWhatsAppMessage(toPhone, messageText, token, phoneId) {
  return new Promise((resolve, reject) => {
    const cleanPhone = toPhone.replace(/\D/g, '');
    const activeToken = token || META_TOKEN;
    const activePhoneId = phoneId || META_PHONE_ID;

    const postData = JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: { preview_url: false, body: messageText }
    });

    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v20.0/${activePhoneId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ raw: body });
          }
        } else {
          reject(new Error(`Meta API Error (${res.statusCode}): ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { to, message, token, phoneId } = body;

    if (!to || !message) {
      return res.status(400).json({ error: 'Missing to or message parameter' });
    }

    const result = await sendMetaWhatsAppMessage(to, message, token, phoneId);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
};
