import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Set DATABASE_URL to the provisioned PostgreSQL service before running cloud migrations.");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(scriptDir, "../migrations");
const migrationNames = (await readdir(migrationDir))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();
const client = new Client({ connectionString: databaseUrl, application_name: "habitability-cloud-migrations" });

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(731921408)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      migration_name text PRIMARY KEY,
      sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = await client.query("SELECT migration_name, sha256 FROM app_schema_migrations");
  const checksums = new Map(applied.rows.map((row) => [row.migration_name, row.sha256.trim()]));
  for (const migrationName of migrationNames) {
    const sql = await readFile(path.join(migrationDir, migrationName), "utf8");
    const sha256 = createHash("sha256").update(sql).digest("hex");
    const previous = checksums.get(migrationName);
    if (previous) {
      if (previous !== sha256) throw new Error(`Applied migration ${migrationName} was edited; add a new migration instead.`);
      continue;
    }

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO app_schema_migrations (migration_name, sha256) VALUES ($1, $2)", [migrationName, sha256]);
      await client.query("COMMIT");
      console.log(`Applied ${migrationName}`);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }
  console.log(`Cloud database schema is current (${migrationNames.length} migrations).`);
} finally {
  await client.query("SELECT pg_advisory_unlock(731921408)").catch(() => undefined);
  await client.end().catch(() => undefined);
}
