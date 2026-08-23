import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

let _pool: Pool | null = null;

export function initializePool(config?: PoolConfig): Pool {
  if (_pool) return _pool;
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString && !config?.connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  _pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...config,
  });
  _pool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
  });
  return _pool;
}

export function getPool(): Pool {
  if (!_pool) {
    throw new Error('Database pool not initialized. Call initializePool() first.');
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Execute a parameterized query. Values are always passed separately —
 * string interpolation into the query text is prohibited.
 */
export async function query<T extends QueryResultRow>(
  pool: Pool,
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

export type { Pool, PoolConfig, QueryResult } from 'pg';
