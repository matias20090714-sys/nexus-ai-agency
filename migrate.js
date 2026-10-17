const db = require('./db');

const sql = `
-- 1. Knowledge Base Documents (RAG)
CREATE TABLE IF NOT EXISTS knowledge_docs (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    client_id VARCHAR(64),
    filename VARCHAR(255) NOT NULL,
    file_type VARCHAR(64),
    file_size INT DEFAULT 0,
    extracted_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Appointments & Anti-Absenteeism Reminders
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    client_id VARCHAR(64),
    contact_name VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(64) NOT NULL,
    service_name VARCHAR(255),
    appointment_date TIMESTAMP WITH TIME ZONE NOT NULL,
    reminder_24h_sent BOOLEAN DEFAULT FALSE,
    reminder_2h_sent BOOLEAN DEFAULT FALSE,
    status VARCHAR(32) DEFAULT 'confirmed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Broadcast Campaigns Anti-Ban
CREATE TABLE IF NOT EXISTS broadcast_campaigns (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    message_template TEXT NOT NULL,
    total_contacts INT DEFAULT 0,
    sent_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    status VARCHAR(32) DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
    phone VARCHAR(64) NOT NULL,
    name VARCHAR(255),
    status VARCHAR(32) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE
);

-- 4. Owner Alert Phone in Agencies
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS owner_alert_phone VARCHAR(64);
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS owner_alerts_enabled BOOLEAN DEFAULT TRUE;
`;

async function run() {
  console.log('⚡ Ejecutando migraciones en Neon PostgreSQL...');
  await db.query(sql);
  console.log('✅ Migraciones aplicadas con éxito!');

  const res = await db.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('📋 Tablas actualizadas en Neon:', res.rows.map(r => r.table_name).join(', '));
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error en migración:', err);
    process.exit(1);
  });
