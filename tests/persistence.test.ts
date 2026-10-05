import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { AddressInfo } from "node:net";
import {
  configurePool,
  databaseConfig,
  checkDatabase,
  transaction,
} from "../db";
import { createApp, expandAndValidateSchedule } from "../server";
import { adaptReminders, localToday } from "../plan-adapter";
import { savedContext } from "../recovery";
import { sha256 } from "../auth";

// Tests must target a disposable database, never recovery_dev.
const testDatabase = process.env.TEST_PGDATABASE;
if (!testDatabase?.startsWith("recovery_test_"))
  throw new Error("Use a disposable TEST_PGDATABASE named recovery_test_*.");
const pool = new pg.Pool({
  host: process.env.TEST_PGHOST || "localhost",
  port: Number(process.env.TEST_PGPORT || 5432),
  database: testDatabase,
  user: process.env.TEST_PGUSER,
  password: process.env.TEST_PGPASSWORD,
  connectionTimeoutMillis: 5000,
});
configurePool(pool);
let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
const origin = "http://localhost:5173";
let generationCalls = 0;
const fullDescription =
  "Полная инструкция: выполнять упражнение медленно, без дополнительной нагрузки. При боли остановиться.";
const reminder = (
  date: string,
  time: string | null = "09:00",
  description = fullDescription,
) => ({ date, time, title: "Упражнение", description });
const fake = {
  recognize: async (bytes: Buffer) => {
    if (bytes.toString() === "ocr-fail") throw new Error("synthetic failure");
    return `Инструкции: ${bytes.toString()}`;
  },
  generate: async (text: string) => {
    generationCalls++;
    if (text.includes("generation-fail")) throw new Error("synthetic failure");
    if (text.includes("demo"))
      return {
        reminders: [reminder("2026-10-05")],
        usedModel: "GigaChat (демо-валидатор)",
        demo: true,
      };
    if (text.includes("changed"))
      return {
        reminders: [
          reminder(
            "2026-10-05",
            "09:00",
            "Изменённая инструкция: два повторения.",
          ),
        ],
        usedModel: "test-model",
      };
    if (text.includes("unknown-times"))
      return {
        reminders: [reminder("2026-10-08", null), reminder("2026-10-08", null)],
        usedModel: "test-model",
      };
    if (text.includes("disjoint"))
      return {
        reminders: [reminder("2026-10-08"), reminder("2026-10-09")],
        usedModel: "test-model",
      };
    if (text.includes("bridge"))
      return {
        reminders: [
          reminder("2026-10-06"),
          reminder("2026-10-07"),
          reminder("2026-10-08"),
        ],
        usedModel: "test-model",
      };
    if (text.includes("overlap"))
      return {
        reminders: [reminder("2026-10-06"), reminder("2026-10-07")],
        usedModel: "test-model",
      };
    return {
      reminders: [reminder("2026-10-05"), reminder("2026-10-06")],
      usedModel: "test-model",
    };
  },
};
before(async () => {
  await pool.query(
    await readFile("db/migrations/001_initial_schema.sql", "utf8"),
  );
  await pool.query(
    await readFile("db/migrations/002_confirmed_instructions.sql", "utf8"),
  );
  await checkDatabase();
  server = createApp(fake).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await pool.end();
});
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
  status = 200,
) {
  const binary = Buffer.isBuffer(body);
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined
        ? {
            "Content-Type": binary
              ? "application/octet-stream"
              : "application/json",
          }
        : {}),
    },
    body:
      body === undefined
        ? undefined
        : binary
          ? new Uint8Array(body as Buffer)
          : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${path} status`);
  return {
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie,
    headers: response.headers,
  };
}
async function register(contact: { email?: string; phone?: string }) {
  return request(
    "/api/auth/register",
    "POST",
    {
      username: "Fictional Patient",
      ...contact,
      password: "Fictional-test-only-123!",
      timezone: "Europe/Moscow",
    },
    "",
    201,
  );
}
async function createCase(cookie: string) {
  return (
    await request(
      "/api/cases",
      "POST",
      { procedureName: "Fictional procedure", startDate: "2026-10-05" },
      cookie,
      201,
    )
  ).data.recoveryCase;
}
async function upload(caseId: string, cookie: string, bytes: string) {
  return (
    await request(
      `/api/ocr?extension=pdf&caseId=${caseId}`,
      "POST",
      Buffer.from(bytes),
      cookie,
    )
  ).data;
}
async function preview(
  draftId: string,
  cookie: string,
  text = "confirmed instructions",
) {
  return (
    await request(
      "/api/generate-schedule",
      "POST",
      { draftId, confirmedText: text, startDate: "2026-10-05" },
      cookie,
    )
  ).data;
}
async function confirm(data: any, cookie: string, decisions = {}) {
  return (
    await request(
      "/api/plans/confirm",
      "POST",
      { draftId: data.draftId, version: data.version, decisions },
      cookie,
    )
  ).data;
}

test("configuration, calendar and adapter checks", () => {
  assert.throws(() => databaseConfig({}), /PGPASSWORD/);
  if (process.env.PGPASSWORD)
    assert.throws(
      () =>
        databaseConfig({
          PGHOST: "localhost",
          PGPORT: "bad",
          PGDATABASE: "test",
          PGUSER: "test",
          PGPASSWORD: process.env.PGPASSWORD,
        }),
      /PGPORT/,
    );
  assert.equal(
    localToday("Europe/Moscow", new Date("2026-10-04T22:00:00Z")),
    "2026-10-05",
  );
  const groups = adaptReminders([
    reminder("2026-10-08", null),
    reminder("2026-10-08", null),
  ]);
  assert.equal(groups[0].events.length, 2);
  assert.equal(groups[0].times, null);
  assert.throws(() => adaptReminders([reminder("2026-02-30")]), /Неверное/);
  const raw = expandAndValidateSchedule(
    JSON.stringify({
      reminders: [
        reminder("2026-10-05"),
        reminder("2026-10-05", "09:00", "Другое назначение"),
      ],
    }),
    "2026-10-05",
  );
  assert.equal(raw.length, 2); // Descriptions must not be discarded by title/time alone.
  const unknown = expandAndValidateSchedule(
    JSON.stringify({
      rules: [
        {
          title: "Unknown time",
          description: "Confirmed instruction",
          duration_days: 2,
        },
      ],
    }),
    "2026-10-05",
  );
  assert.equal(unknown[0].time, null);
  assert.equal(unknown.length, 2);
});

test("registration, normalized unique contacts, login, cookies, origins, expiry and logout", async () => {
  const a = await register({ email: " Fictional@EXAMPLE.test " });
  const b = await register({ phone: "+1 (202) 555-0191" });
  assert.equal(a.data.patient.email, "fictional@example.test");
  assert.equal(b.data.patient.phone, "+12025550191");
  assert.equal(a.data.patient.username, b.data.patient.username);
  assert.match(a.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(a.headers.get("set-cookie")!, /SameSite=Lax/);
  assert.equal("password_hash" in a.data.patient, false);
  await request(
    "/api/auth/register",
    "POST",
    {
      username: "Dup",
      email: "FICTIONAL@example.test",
      password: "Fictional-test-only-123!",
      timezone: "Europe/Moscow",
    },
    "",
    409,
  );
  await request(
    "/api/auth/register",
    "POST",
    {
      username: "Dup",
      phone: "+12025550191",
      password: "Fictional-test-only-123!",
      timezone: "Europe/Moscow",
    },
    "",
    409,
  );
  await request(
    "/api/auth/register",
    "POST",
    {
      username: "Invalid",
      phone: "2025550192",
      password: "Fictional-test-only-123!",
      timezone: "Europe/Moscow",
    },
    "",
    400,
  );
  await request(
    "/api/auth/register",
    "POST",
    {
      username: "Invalid",
      email: "invalid@example.test",
      password: "Fictional-test-only-123!",
      timezone: "Mars/Base",
    },
    "",
    400,
  );
  await request(
    "/api/auth/login",
    "POST",
    { contact: "fictional@example.test", password: "incorrect-password" },
    "",
    401,
  );
  const login = await request("/api/auth/login", "POST", {
    contact: "fictional@example.test",
    password: "Fictional-test-only-123!",
  });
  await request("/api/auth/login", "POST", {
    contact: "+1 202 555 0191",
    password: "Fictional-test-only-123!",
  });
  assert.equal(
    (await request("/api/auth/me", "GET", undefined, login.cookie)).data.patient
      .id,
    a.data.patient.id,
  );
  const raw = login.cookie.split("=")[1];
  const stored = (
    await pool.query("SELECT token_hash FROM sessions WHERE token_hash=$1", [
      sha256(raw),
    ])
  ).rows[0];
  assert.equal(stored.token_hash, sha256(raw));
  assert.notEqual(stored.token_hash, raw);
  assert.match(
    (
      await pool.query("SELECT password_hash FROM patients WHERE id=$1", [
        a.data.patient.id,
      ])
    ).rows[0].password_hash,
    /^\$argon2id\$/,
  );
  const denied = await fetch(base + "/api/cases", {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      Cookie: login.cookie,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  await pool.query(
    "UPDATE sessions SET created_at=CURRENT_TIMESTAMP-interval '2 days',expires_at=CURRENT_TIMESTAMP-interval '1 day' WHERE token_hash=$1",
    [sha256(raw)],
  );
  assert.equal(
    (await request("/api/auth/me", "GET", undefined, login.cookie)).data
      .patient,
    null,
  );
  await request("/api/cases", "GET", undefined, login.cookie, 401);
  await request("/api/auth/logout", "POST", undefined, a.cookie);
  assert.equal(
    (await request("/api/auth/me", "GET", undefined, a.cookie)).data.patient,
    null,
  );
});

test("confirmed whole plan, reload, ownership, completion, repeated and overlapping uploads", async () => {
  const a = await register({ email: "plan-a@example.test" }),
    b = await register({ email: "plan-b@example.test" });
  const c = await createCase(a.cookie);
  await request(`/api/cases/${c.id}/plan`, "GET", undefined, b.cookie, 404);
  const draft = await upload(c.id, a.cookie, "file-one");
  await request(
    `/api/ocr?extension=pdf&caseId=${c.id}`,
    "POST",
    Buffer.from("file-one"),
    a.cookie,
    409,
  );
  assert.equal(
    (await request(`/api/cases/${c.id}/plan`, "GET", undefined, a.cookie)).data
      .events.length,
    0,
  );
  const generated = await preview(draft.draftId, a.cookie);
  assert.equal(
    (await request(`/api/cases/${c.id}/plan`, "GET", undefined, a.cookie)).data
      .events.length,
    0,
  );
  const saved = await confirm(generated, a.cookie);
  assert.equal(saved.events.length, 2);
  assert.equal(saved.plan.status, "confirmed");
  assert.equal(saved.plan.confirmed_instructions, "confirmed instructions");
  assert.equal(saved.prescriptions[0].instruction, fullDescription);
  assert.equal(saved.prescriptions[0].dose_text, null);
  assert.equal(saved.prescriptions[0].duration_days, null);
  const event = saved.events[0];
  await request(
    `/api/events/${event.id}`,
    "PATCH",
    { completed: true },
    b.cookie,
    404,
  );
  await request(
    `/api/events/${event.id}`,
    "PATCH",
    { completed: true },
    a.cookie,
  );
  const reload = (
    await request(`/api/cases/${c.id}/plan`, "GET", undefined, a.cookie)
  ).data;
  assert.equal(reload.events[0].status, "completed");
  assert.ok(reload.events[0].completed_at);
  const same = await upload(c.id, a.cookie, "file-one");
  assert.equal(same.existing, true);
  assert.equal(same.events[0].id, event.id);
  assert.equal(same.events[0].status, "completed");
  const double = await confirm(generated, a.cookie);
  assert.equal(double.events.length, 2);
  const photo = await upload(c.id, a.cookie, "different-photo");
  const identical = await confirm(
    await preview(photo.draftId, a.cookie),
    a.cookie,
  );
  assert.deepEqual(
    identical.events.map((e: any) => e.id),
    reload.events.map((e: any) => e.id),
  );
  const overlapping = await upload(c.id, a.cookie, "photo-overlap");
  const expanded = await confirm(
    await preview(overlapping.draftId, a.cookie, "overlap"),
    a.cookie,
  );
  assert.equal(expanded.events.length, 3);
  assert.equal(expanded.prescriptions.length, 1);
  assert.equal(expanded.events[0].status, "completed");
  assert.equal(expanded.prescriptions[0].ends_on, "2026-10-07");
  const disjoint = await upload(c.id, a.cookie, "disjoint-file");
  const separate = await confirm(
    await preview(disjoint.draftId, a.cookie, "disjoint"),
    a.cookie,
  );
  assert.equal(separate.prescriptions.length, 2);
  assert.equal(separate.events.length, 5);
  const bridge = await upload(c.id, a.cookie, "bridge-file");
  const bridged = await confirm(
    await preview(bridge.draftId, a.cookie, "bridge"),
    a.cookie,
  );
  assert.equal(bridged.events.length, 5);
  assert.deepEqual(
    bridged.events.map((e: any) => e.id),
    separate.events.map((e: any) => e.id),
  );
  await request(
    "/api/chat",
    "POST",
    { caseId: c.id, messages: [] },
    b.cookie,
    404,
  );
  assert.match(
    await savedContext(c.id, a.data.patient.id),
    /Полная инструкция/,
  );
  await request(
    `/api/events/${event.id}`,
    "PATCH",
    { completed: false },
    a.cookie,
  );
  const cleared = (
    await request(`/api/cases/${c.id}/plan`, "GET", undefined, a.cookie)
  ).data;
  assert.equal(cleared.events[0].completed_at, null);
  assert.equal(
    (
      await request(
        `/api/cases/${c.id}/events?from=2026-10-05&to=2026-10-07`,
        "GET",
        undefined,
        a.cookie,
      )
    ).data.events.length,
    3,
  );
  await request(`/api/cases/${c.id}/events`, "GET", undefined, b.cookie, 404);
  await request(
    "/api/plans/confirm",
    "POST",
    { draftId: overlapping.draftId, version: 0 },
    b.cookie,
    410,
  );
});

test("conflicts require confirmation; replacement preserves completed history", async () => {
  const user = await register({ email: "conflict@example.test" }),
    c = await createCase(user.cookie);
  const original = await confirm(
    await preview(
      (await upload(c.id, user.cookie, "base")).draftId,
      user.cookie,
    ),
    user.cookie,
  );
  await request(
    `/api/events/${original.events[0].id}`,
    "PATCH",
    { completed: true },
    user.cookie,
  );
  const draft = await upload(c.id, user.cookie, "changed-file");
  const generated = await preview(draft.draftId, user.cookie, "changed");
  assert.equal(generated.changes[0].conflicts.length, 1);
  await request(
    "/api/plans/confirm",
    "POST",
    { draftId: draft.draftId, version: generated.version },
    user.cookie,
    409,
  );
  assert.equal(
    (await request(`/api/cases/${c.id}/plan`, "GET", undefined, user.cookie))
      .data.prescriptions.length,
    1,
  );
  const replaced = await confirm(generated, user.cookie, {
    [generated.changes[0].key]: "replace",
  });
  assert.equal(replaced.prescriptions[0].status, "superseded");
  assert.equal(
    replaced.events.find((e: any) => e.id === original.events[0].id).status,
    "completed",
  );
  assert.equal(
    replaced.events.find((e: any) => e.id === original.events[1].id).status,
    "cancelled",
  );
});

test("demo rejection, failed processing retries, concurrent saves, unknown times and rollback", async () => {
  const user = await register({ email: "retry@example.test" }),
    c = await createCase(user.cookie);
  await request(
    `/api/ocr?extension=pdf&caseId=${c.id}`,
    "POST",
    Buffer.from("ocr-fail"),
    user.cookie,
    500,
  );
  await request(
    `/api/ocr?extension=pdf&caseId=${c.id}`,
    "POST",
    Buffer.from("ocr-fail"),
    user.cookie,
    500,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT attempt_count,status FROM upload_records WHERE recovery_case_id=$1 AND file_sha256=$2",
        [c.id, sha256("ocr-fail")],
      )
    ).rows[0].attempt_count,
    2,
  );
  const draft = await upload(c.id, user.cookie, "demo-file");
  await request(
    "/api/generate-schedule",
    "POST",
    { draftId: draft.draftId, confirmedText: "demo", startDate: "2026-10-05" },
    user.cookie,
    503,
  );
  assert.equal(
    (await request(`/api/cases/${c.id}/plan`, "GET", undefined, user.cookie))
      .data.plan,
    null,
  );
  const generation = await preview(draft.draftId, user.cookie, "unknown-times");
  // Force a real PostgreSQL failure after prescription insertion: the save must roll back.
  await pool.query(
    "CREATE FUNCTION reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER reject_test_event BEFORE INSERT ON plan_events FOR EACH ROW EXECUTE FUNCTION reject_test_event()",
  );
  await request(
    "/api/plans/confirm",
    "POST",
    { draftId: draft.draftId, version: generation.version },
    user.cookie,
    500,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM prescriptions p JOIN plans pl ON pl.id=p.plan_id WHERE pl.recovery_case_id=$1",
        [c.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM upload_records WHERE id=(SELECT id FROM upload_records WHERE recovery_case_id=$1 AND file_sha256=$2)",
        [c.id, sha256("demo-file")],
      )
    ).rows[0].status,
    "failed",
  );
  await pool.query("DROP TRIGGER reject_test_event ON plan_events");
  const results = await Promise.all([
    confirm(generation, user.cookie),
    confirm(generation, user.cookie),
  ]);
  assert.equal(results[0].events.length, 2);
  assert.equal(results[1].events.length, 2);
  assert.deepEqual(
    results[0].events.map((e: any) => e.occurrence_index),
    [1, 2],
  );
  assert.equal(results[0].events[0].scheduled_time, null);
  const other = await upload(c.id, user.cookie, "unknown-times-other");
  const repeat = await confirm(
    await preview(other.draftId, user.cookie, "unknown-times"),
    user.cookie,
  );
  assert.equal(repeat.events.length, 2);
  assert.equal(repeat.events[0].id, results[0].events[0].id);
  const badPool = new pg.Pool({
    host: "127.0.0.1",
    port: 1,
    database: testDatabase,
    connectionTimeoutMillis: 200,
  });
  await assert.rejects(badPool.query("SELECT 1"));
  await badPool.end();
});

test(
  "browser registration, plan confirmation, reload, profile and completion",
  { skip: !process.env.TEST_PLAYWRIGHT_MODULE },
  async () => {
    const { chromium } = await import(process.env.TEST_PLAYWRIGHT_MODULE!);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      // Forward only this browser's API calls to the isolated test server. The
      // developer's live database never receives browser test patients.
      await context.route("**/api/**", async (route: any) => {
        const request = route.request();
        const url = new URL(request.url());
        const response = await route.fetch({
          url: base + url.pathname + url.search,
        });
        await route.fulfill({ response });
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      await page.goto("http://localhost:5173");
      await page
        .getByRole("button", { name: "Авторизуйтесь", exact: true })
        .click();
      await page
        .getByPlaceholder("Ваше имя (для профиля)")
        .fill("Browser Fictional Patient");
      await page
        .getByPlaceholder("Телефон или эл. почта")
        .fill("browser@example.test");
      await page
        .getByPlaceholder("Пароль", { exact: true })
        .fill("Fictional-test-only-123!");
      await page
        .getByRole("button", { name: "Создать аккаунт", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Аккаунт", exact: true })
        .waitFor();
      await page
        .getByLabel("Операция нового эпизода")
        .selectOption({ label: "Остеосинтез при переломе" });
      await page
        .getByRole("button", { name: "Создать эпизод", exact: true })
        .click();
      await page.waitForFunction(() =>
        Boolean(
          (
            document.querySelector(
              '[aria-label="Эпизод восстановления"]',
            ) as HTMLSelectElement
          )?.value,
        ),
      );
      await page
        .locator('input[type=file][accept^=".pdf"]')
        .setInputFiles({
          name: "fictional.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("browser-file"),
        });
      await page.getByLabel("Подтверждённые рекомендации").waitFor();
      await page
        .locator("input[type=date]")
        .filter({ visible: true })
        .first()
        .fill("2026-10-05");
      await page
        .getByRole("button", { name: "Подтвердить текст", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Подтвердить и сохранить план",
          exact: true,
        })
        .click();
      await page
        .getByText(
          "План сохранён. Задачи и отметки выполнения доступны после перезагрузки.",
        )
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "Аккаунт", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Задачи", exact: true }).hover();
      await page.getByLabel("Дата задач").fill("2026-10-05");
      await page
        .getByRole("button", { name: "09:00 · Упражнение", exact: true })
        .click();
      await page.waitForFunction(async () => {
        const id = (
          document.querySelector(
            '[aria-label="Эпизод восстановления"]',
          ) as HTMLSelectElement
        ).value;
        const data = await (await fetch(`/api/cases/${id}/plan`)).json();
        return data.events.some((e: any) => e.status === "completed");
      });
      await page.reload();
      await page
        .getByRole("button", { name: "Аккаунт", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Задачи", exact: true }).hover();
      await page.getByLabel("Дата задач").fill("2026-10-05");
      const button = page.getByRole("button", {
        name: "09:00 · Упражнение",
        exact: true,
      });
      await button.waitFor();
      assert.equal(await button.locator("svg").count(), 1);
      await button.click();
      await page.waitForFunction(async () => {
        const id = (
          document.querySelector(
            '[aria-label="Эпизод восстановления"]',
          ) as HTMLSelectElement
        ).value;
        const data = await (await fetch(`/api/cases/${id}/plan`)).json();
        return data.events.every(
          (e: any) => e.status === "pending" && e.completed_at === null,
        );
      });
      await page.mouse.move(900, 600);
      await page.getByRole("button", { name: "Аккаунт", exact: true }).click();
      await page
        .getByRole("heading", {
          name: "Browser Fictional Patient",
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator("img").count(), 2);
      await page.waitForFunction(() =>
        Array.from(document.images).every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("main > div")!).opacity ===
          "1",
      );
      if (process.env.TEST_SCREENSHOT_PATH)
        await page.screenshot({ path: process.env.TEST_SCREENSHOT_PATH });
      await page
        .getByRole("button", { name: "Выйти из аккаунта", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Авторизуйтесь", exact: true })
        .waitFor();
      assert.deepEqual(pageErrors, []);
      await context.close();
    } finally {
      await browser.close();
    }
  },
);

test(
  "live OCR and GigaChat pipeline against isolated storage",
  { skip: process.env.RUN_LIVE_PIPELINE !== "1" },
  async () => {
    const oldBase = base;
    const live = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => live.once("listening", resolve));
    base = `http://127.0.0.1:${(live.address() as AddressInfo).port}`;
    try {
      const user = await register({ email: "live-pipeline@example.test" }),
        c = await createCase(user.cookie);
      const pdf = await readFile(process.env.TEST_DOCUMENT_PATH!);
      const draft = (
        await request(
          `/api/ocr?extension=pdf&caseId=${c.id}`,
          "POST",
          pdf,
          user.cookie,
        )
      ).data;
      assert.match(draft.text, /Walk/i);
      const generated = await preview(draft.draftId, user.cookie, draft.text);
      const persisted = await confirm(generated, user.cookie);
      assert.ok(persisted.events.length >= 2);
      const repeated = (
        await request(
          `/api/ocr?extension=pdf&caseId=${c.id}`,
          "POST",
          pdf,
          user.cookie,
        )
      ).data;
      assert.equal(repeated.existing, true);
      assert.deepEqual(
        repeated.events.map((e: any) => e.id),
        persisted.events.map((e: any) => e.id),
      );
      const chat = await request(
        "/api/chat",
        "POST",
        {
          caseId: c.id,
          messages: [
            {
              role: "user",
              content: "Привет! Кратко напомни о моих рекомендациях.",
            },
          ],
        },
        user.cookie,
      );
      assert.ok(chat.data.reply);
    } finally {
      base = oldBase;
      await new Promise<void>((resolve) => live.close(() => resolve()));
    }
  },
);

test("stable confirmed start dates, failed generation retry, draft cancellation and stale previews", async () => {
  const user = await register({ email: "stable-start@example.test" });
  const c = (
    await request(
      "/api/cases",
      "POST",
      { procedureName: "Separate episode" },
      user.cookie,
      201,
    )
  ).data.recoveryCase;
  const draft = await upload(c.id, user.cookie, "relative-instructions");
  await request(
    "/api/generate-schedule",
    "POST",
    { draftId: draft.draftId, confirmedText: "confirmed" },
    user.cookie,
    400,
  );
  await request(
    "/api/generate-schedule",
    "POST",
    {
      draftId: draft.draftId,
      confirmedText: "generation-fail",
      startDate: "2026-10-05",
    },
    user.cookie,
    500,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM upload_records WHERE recovery_case_id=$1",
        [c.id],
      )
    ).rows[0].status,
    "failed",
  );
  const generated = await preview(draft.draftId, user.cookie);
  await confirm(generated, user.cookie);
  const subsequent = await upload(c.id, user.cookie, "second-upload");
  await request(
    "/api/generate-schedule",
    "POST",
    {
      draftId: subsequent.draftId,
      confirmedText: "confirmed",
      startDate: "2026-10-06",
    },
    user.cookie,
    409,
  );
  const previewed = await preview(subsequent.draftId, user.cookie, "overlap");
  await request(
    `/api/cases/${c.id}/tasks`,
    "POST",
    { text: "Fictional personal task", date: "2026-10-05" },
    user.cookie,
  );
  await request(
    "/api/plans/confirm",
    "POST",
    { draftId: subsequent.draftId, version: previewed.version },
    user.cookie,
    409,
  );
  const refreshed = await preview(subsequent.draftId, user.cookie, "overlap");
  await confirm(refreshed, user.cookie);
  assert.equal(
    (
      await pool.query(
        "SELECT recovery_start_date FROM recovery_cases WHERE id=$1",
        [c.id],
      )
    ).rows[0].recovery_start_date,
    "2026-10-05",
  );
  const cancel = await upload(c.id, user.cookie, "cancelled-file");
  await request(
    `/api/drafts/${cancel.draftId}`,
    "DELETE",
    undefined,
    user.cookie,
  );
  const retry = await upload(c.id, user.cookie, "cancelled-file");
  assert.ok(retry.draftId);
  assert.notEqual(retry.draftId, cancel.draftId);
});

test("keeping a conflict preserves the complete confirmed document and old event IDs", async () => {
  const user = await register({ email: "keep-conflict@example.test" }),
    c = await createCase(user.cookie);
  const original = await confirm(
    await preview(
      (await upload(c.id, user.cookie, "keep-original")).draftId,
      user.cookie,
    ),
    user.cookie,
  );
  const draft = await upload(c.id, user.cookie, "keep-changed");
  const complete =
    "changed: non-calendar instruction must remain in the confirmed document.";
  const generated = await preview(draft.draftId, user.cookie, complete);
  const saved = await confirm(generated, user.cookie, {
    [generated.changes[0].key]: "keep",
  });
  assert.deepEqual(
    saved.events.map((e: any) => e.id),
    original.events.map((e: any) => e.id),
  );
  assert.match(saved.plan.confirmed_instructions, /non-calendar instruction/);
  assert.match(saved.plan.confirmed_instructions, /не применяется/);
});
