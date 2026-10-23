const { Client } = require('pg');

// SQL Migration Script for NEXUS AI Agency Database
const schemaSQL = `
-- Drop existing tables to start 100% clean
DROP TABLE IF EXISTS whatsapp_messages CASCADE;
DROP TABLE IF EXISTS whatsapp_conversations CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS agencies CASCADE;

-- 1. Agencies Table (Multi-tenant)
CREATE TABLE agencies (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    brand_color VARCHAR(32) DEFAULT '#6366f1',
    billing_phone VARCHAR(64),
    bank_name VARCHAR(128),
    bank_holder VARCHAR(255),
    bank_cbu VARCHAR(128),
    bank_tax_id VARCHAR(64),
    owner_alert_phone VARCHAR(64),
    owner_alerts_enabled BOOLEAN DEFAULT TRUE,
    portal_title TEXT,
    portal_subtitle TEXT,
    portal_config JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users / Accounts Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) DEFAULT 'agency_admin', -- superadmin, agency_admin, client
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Commercial Plans Table
CREATE TABLE plans (
    id VARCHAR(64) PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'USD',
    period VARCHAR(32) DEFAULT 'mes',
    category VARCHAR(255),
    features JSONB DEFAULT '[]'::jsonb,
    payment_link TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Clients / Sub-accounts Table
CREATE TABLE clients (
    id VARCHAR(64) PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    industry VARCHAR(128),
    phone VARCHAR(64),
    email VARCHAR(255),
    plan_id VARCHAR(64) REFERENCES plans(id) ON DELETE SET NULL,
    status VARCHAR(32) DEFAULT 'active', -- active, trial, suspended
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Leads & Pipeline Table
CREATE TABLE leads (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(64),
    email VARCHAR(255),
    status VARCHAR(64) DEFAULT 'nuevo', -- nuevo, contactado, demo_enviada, negociacion, ganado, perdido
    value NUMERIC(10, 2) DEFAULT 0,
    source VARCHAR(64) DEFAULT 'whatsapp',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Quotes / Invoicing Table
CREATE TABLE quotes (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    client_id VARCHAR(64) REFERENCES clients(id) ON DELETE SET NULL,
    folio VARCHAR(64) NOT NULL,
    client_name VARCHAR(255),
    client_phone VARCHAR(64),
    client_email VARCHAR(255),
    items JSONB DEFAULT '[]'::jsonb,
    subtotal NUMERIC(10, 2) DEFAULT 0,
    discount_pct NUMERIC(5, 2) DEFAULT 0,
    tax_pct NUMERIC(5, 2) DEFAULT 0,
    total NUMERIC(10, 2) DEFAULT 0,
    validity VARCHAR(64) DEFAULT '15 Días',
    notes TEXT,
    status VARCHAR(32) DEFAULT 'pending', -- pending, accepted, paid, expired
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. WhatsApp Conversations & Messages
CREATE TABLE whatsapp_conversations (
    id SERIAL PRIMARY KEY,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    phone VARCHAR(64) NOT NULL,
    contact_name VARCHAR(255),
    last_message TEXT,
    unread_count INT DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(agency_id, phone)
);

CREATE TABLE whatsapp_messages (
    id SERIAL PRIMARY KEY,
    conversation_id INT REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    agency_id VARCHAR(64) REFERENCES agencies(id) ON DELETE CASCADE,
    sender VARCHAR(64) NOT NULL,
    recipient VARCHAR(64) NOT NULL,
    message_text TEXT NOT NULL,
    direction VARCHAR(16) NOT NULL, -- incoming, outgoing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Initial Master Agency Seed
INSERT INTO agencies (id, name, slug, brand_color, billing_phone, bank_name, bank_holder, bank_cbu, bank_tax_id)
VALUES (
    'agency_master_1',
    'NEXUS AI Agency',
    'nexus-ai',
    '#6366f1',
    '5491148923310',
    'Santander / Mercado Pago',
    'NEXUS AI Agency S.A.',
    '00000031000123456789',
    '20-39485921-9'
) ON CONFLICT (id) DO NOTHING;

-- Initial Plans Seed
INSERT INTO plans (id, agency_id, name, price, currency, period, category, features, payment_link)
VALUES 
(
    'plan_starter',
    'agency_master_1',
    'Plan Starter IA',
    290.00,
    'USD',
    'mes',
    'Negocios & Comercios Locales',
    '["1 Agente de WhatsApp 24/7 entrenado a medida", "Respuestas instantáneas en menos de 2 seg", "Catálogo interactivo de servicios/productos", "Derivación a WhatsApp personal ante emergencias", "Mantenimiento mensual e IA incluida"]'::jsonb,
    ''
),
(
    'plan_pro',
    'agency_master_1',
    'Plan Growth Pro Multi-Flujo',
    690.00,
    'USD',
    'mes',
    '★ DESTACADO | Clínicas, Inmobiliarias & Empresas',
    '["Todo lo incluido en Starter", "Agendamiento Automático en Google Calendar", "Recordatorios WhatsApp anti-ausentismo (24h y 2h)", "Generador de Cotizaciones con links de pago", "Encuestas NPS y Reseñas en Google Maps 5★", "CRM Kanban y Pipeline de Leads en tiempo real"]'::jsonb,
    ''
) ON CONFLICT (id) DO NOTHING;

-- Initial Admin User Seed (Password: admin123)
INSERT INTO users (agency_id, name, email, password_hash, role)
VALUES (
    'agency_master_1',
    'Administrador Principal',
    'admin@nexus-ai.agency',
    'admin123',
    'superadmin'
) ON CONFLICT (email) DO NOTHING;
`;

async function initDatabase(connectionString) {
  if (!connectionString) {
    throw new Error('No se proporcionó una cadena de conexión (connectionString).');
  }

  console.log('🔌 Conectando a Neon PostgreSQL...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Conexión establecida con éxito con Neon!');
    console.log('🧹 Limpiando y creando esquema completo de la agencia...');

    await client.query(schemaSQL);
    console.log('🎉 ¡Base de datos de la agencia inicializada con éxito!');

    // Verify created tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('📋 Tablas creadas:', res.rows.map(r => r.table_name).join(', '));
  } catch (err) {
    console.error('❌ Error al inicializar la base de datos:', err.message);
    throw err;
  } finally {
    await client.end();
  }
}

// If run from command line
if (require.main === module) {
  const defaultNeon = 'postgresql://neondb_owner:npg_KdzIZv8FU1pw@ep-shy-paper-awsq0tf3-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require';
  const connStr = process.argv[2] || process.env.DATABASE_URL || defaultNeon;
  console.log('Running init-db with target database...');
  initDatabase(connStr)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { initDatabase, schemaSQL };
