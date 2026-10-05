import pg, { Pool, PoolClient } from "pg";

// Keep PostgreSQL DATE and local TIME values independent of the host timezone.
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1083, (value) => value);

export function databaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const required = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD"];
  const missing = required.filter(
    (name) => !env[name]?.trim() || env[name] === "CHANGE_ME",
  );
  if (missing.length)
    throw new Error(
      `Database configuration missing: ${missing.join(", ")}. Configure the root .env.`,
    );
  const port = Number(env.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PGPORT must be a valid TCP port.");
  return {
    host: env.PGHOST,
    port,
    database: env.PGDATABASE,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    connectionTimeoutMillis: 5000,
    max: 10,
  };
}
let pool: Pool | undefined;
export function configurePool(connectionPool: Pool) {
  if (pool) throw new Error("Database pool is already initialized.");
  pool = connectionPool;
}
export function database() {
  if (!pool) {
    pool = new Pool(databaseConfig());
    pool.on("error", () => console.error("Database connection interrupted."));
  }
  return pool;
}
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function checkDatabase() {
  try {
    const { rows } = await database().query(
      "SELECT version FROM schema_migrations WHERE version IN ('001_initial_schema', '002_confirmed_instructions')",
    );
    if (rows.length !== 2)
      throw new Error(
        "Apply the required numbered migrations before starting the backend.",
      );
  } catch (error) {
    if (
      error instanceof Error &&
      /configuration missing|PGPORT|numbered migrations/.test(error.message)
    )
      throw error;
    throw new Error(
      "Cannot connect to the configured PostgreSQL database or read its schema. Check PostgreSQL, credentials, and migrations.",
    );
  }
}
