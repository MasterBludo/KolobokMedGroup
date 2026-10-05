import dotenv from "dotenv";
import pg from "pg";
import { readFile } from "node:fs/promises";
import { databaseConfig } from "../db";
dotenv.config({ quiet: true });
let client: pg.Client | undefined;
try {
  client = new pg.Client(databaseConfig());
  await client.connect();
  for (const name of ["002_confirmed_instructions", "003_patient_plan"]) {
    await client.query(await readFile(new URL(`../db/migrations/${name}.sql`, import.meta.url), "utf8"));
    console.log(`Migration ${name} applied (or already present).`);
  }
} catch (error) {
  console.error(
    error instanceof Error && /configuration missing|PGPORT|Migration conflict|must already be applied/.test(error.message)
      ? error.message
      : "Migration failed. Check local database configuration and the previously applied 001 migration.",
  );
  process.exitCode = 1;
} finally {
  await client?.end();
}
