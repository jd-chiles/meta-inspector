import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export class JobInfrastructureError extends Error {
  readonly code = "JOB_INFRASTRUCTURE_UNAVAILABLE";

  constructor(message = "Durable video processing is not configured on this server.") {
    super(message);
    this.name = "JobInfrastructureError";
  }
}

export function getJobPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString || !/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new JobInfrastructureError();
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 12,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: "move-in-ready-video-jobs",
    });
    pool.on("error", () => {
      // Do not log driver details: connection strings and provider-adjacent
      // request metadata must not enter application logs.
    });
  }
  return pool;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getJobPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    client.release();
  }
}

export function isDatabaseRow(value: unknown): value is QueryResultRow {
  return typeof value === "object" && value !== null;
}
