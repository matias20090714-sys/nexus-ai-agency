const { Pool } = require('pg');

let pool = null;

function getDbPool() {
  if (pool) return pool;

  const defaultNeon = 'postgresql://neondb_owner:npg_KdzIZv8FU1pw@ep-shy-paper-awsq0tf3-pooler.c-12.us-east-1.aws.neon.tech/neondb?sslmode=require';
  const connectionString = process.env.DATABASE_URL || defaultNeon;

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000
  });

  pool.on('error', (err) => {
    console.error('Error imprevisto en el pool de Neon PostgreSQL:', err.message);
  });

  return pool;
}

async function query(text, params) {
  const p = getDbPool();
  if (!p) return null;
  return p.query(text, params);
}

module.exports = {
  getDbPool,
  query
};
