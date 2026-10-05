import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

// Called only in the disposable cluster, before the API starts.
export async function verifyPatientPlanMigration(pool: Pool) {
  const sql = await readFile("db/migrations/003_patient_plan.sql", "utf8");
  const patient = (await pool.query(`INSERT INTO patients(username,email,password_hash) VALUES('Migration fixture','migration@example.test','fixture-hash') RETURNING *`)).rows[0];
  const other = (await pool.query(`INSERT INTO patients(username,email,password_hash) VALUES('Migration empty','migration-empty@example.test','fixture-hash') RETURNING *`)).rows[0];
  const recovery = (await pool.query(`INSERT INTO recovery_cases(patient_id,procedure_name,surgery_date,recovery_start_date,status) VALUES($1,'Legacy procedure','2024-01-01','2024-01-03','completed') RETURNING *`, [patient.id])).rows[0];
  const empty = (await pool.query(`INSERT INTO recovery_cases(patient_id,procedure_name,surgery_date,recovery_start_date,status) VALUES($1,'Legacy without plan','2023-02-01','2023-02-05','archived') RETURNING *`, [other.id])).rows[0];
  const plan = (await pool.query(`INSERT INTO plans(recovery_case_id,status,confirmed_at,confirmed_instructions,version) VALUES($1,'confirmed','2024-01-02','Legacy confirmed instructions',7) RETURNING *`, [recovery.id])).rows[0];
  const prescription = (await pool.query(`INSERT INTO prescriptions(plan_id,title,instruction,starts_on,ends_on,dedup_key) VALUES($1,'Legacy task','Legacy full instruction','2024-01-03','2024-01-04',repeat('a',64)) RETURNING *`, [plan.id])).rows[0];
  await pool.query(`INSERT INTO plan_events(plan_id,prescription_id,scheduled_date,status,completed_at) VALUES($1,$2,'2024-01-03','completed','2024-01-03 09:00:00+03'),($1,$2,'2024-01-04','pending',NULL)`, [plan.id, prescription.id]);
  await pool.query(`INSERT INTO upload_records(recovery_case_id,file_sha256,status,processed_at,attempt_count) VALUES($1,repeat('b',64),'completed','2024-01-02',3),($2,repeat('b',64),'failed','2023-02-02',2)`, [recovery.id, empty.id]);
  await pool.query(`INSERT INTO sessions(patient_id,token_hash,expires_at) VALUES($1,repeat('c',64),CURRENT_TIMESTAMP+interval '7 days')`, [patient.id]);
  const snapshot = async (table: string) => (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  const preserved = new Map<string, any[]>();
  for (const table of ["patients", "sessions", "prescriptions", "plan_events", "plans", "upload_records"])
    preserved.set(table, await snapshot(table));

  // Two cases, two plans and duplicate hashes must abort without changing schema/data.
  const conflicting = (await pool.query(`INSERT INTO recovery_cases(patient_id) VALUES($1) RETURNING id`, [patient.id])).rows[0];
  await pool.query(`INSERT INTO plans(recovery_case_id) VALUES($1)`, [conflicting.id]);
  await pool.query(`INSERT INTO upload_records(recovery_case_id,file_sha256) VALUES($1,repeat('b',64))`, [conflicting.id]);
  const client = await pool.connect();
  try {
    await assert.rejects(client.query(sql), /Migration conflict: multiple recovery cases/);
    await client.query("ROLLBACK");
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='plans' AND column_name='patient_id'`)).rows[0].n, 0);
  } finally { client.release(); }
  // Remove only the intentionally conflicting fixture in this disposable database.
  await pool.query("DELETE FROM recovery_cases WHERE id=$1", [conflicting.id]);
  await pool.query(sql);
  for (const table of ["patients", "sessions", "prescriptions", "plan_events"])
    assert.deepEqual(await snapshot(table), preserved.get(table), `${table} unchanged`);
  const migratedPlan = (await pool.query("SELECT * FROM plans WHERE id=$1", [plan.id])).rows[0];
  const { recovery_case_id: _old, ...oldPlan } = preserved.get("plans")![0];
  assert.deepEqual(migratedPlan, { ...oldPlan, patient_id: patient.id, recovery_start_date: recovery.recovery_start_date,
    procedure_name: recovery.procedure_name, surgery_date: recovery.surgery_date, recovery_status: recovery.status });
  const emptyPlan = (await pool.query("SELECT * FROM plans WHERE patient_id=$1", [other.id])).rows[0];
  assert.equal(emptyPlan.recovery_start_date, empty.recovery_start_date);
  assert.equal(emptyPlan.surgery_date, empty.surgery_date);
  assert.equal(emptyPlan.procedure_name, empty.procedure_name);
  assert.equal(emptyPlan.recovery_status, empty.status);
  assert.equal(emptyPlan.status, "draft");
  assert.equal(emptyPlan.created_at.getTime(), empty.created_at.getTime());
  assert.equal(emptyPlan.updated_at.getTime(), empty.updated_at.getTime());
  for (const oldUpload of preserved.get("upload_records")!) {
    const { recovery_case_id, ...values } = oldUpload;
    const migrated = (await pool.query("SELECT * FROM upload_records WHERE id=$1", [values.id])).rows[0];
    assert.deepEqual(migrated, { ...values, patient_id: recovery_case_id === recovery.id ? patient.id : other.id });
  }
  assert.equal((await pool.query("SELECT to_regclass('public.recovery_cases') AS table_name")).rows[0].table_name, null);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE column_name='recovery_case_id'`)).rows[0].n, 0);
  await assert.rejects(pool.query("INSERT INTO plans(patient_id) VALUES($1)", [patient.id]), /plans_patient_unique/);
  await assert.rejects(pool.query("INSERT INTO upload_records(patient_id,file_sha256) VALUES($1,repeat('b',64))", [patient.id]), /upload_records_file_patient_unique/);
  // Applying again must leave every row untouched.
  const after = await snapshot("plans");
  await pool.query(sql);
  assert.deepEqual(await snapshot("plans"), after);
  console.log("Migration 003: conflict rollback, preserved rows/dates/completion/sessions, case without plan, uniqueness, and idempotency verified.");
}
