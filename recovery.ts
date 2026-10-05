import { Router } from "express";
import { randomBytes } from "node:crypto";
import { PoolClient } from "pg";
import { database, transaction } from "./db";
import { ApiError, authenticate, wrap, sha256, username } from "./auth";
import {
  adaptReminders,
  Instruction,
  normalize,
  possibleConflict,
  prescriptionKey,
  validDate,
  localToday,
} from "./plan-adapter";

interface Draft {
  id: string;
  patientId: string;
  uploadId: string;
  attempt: number;
  text: string;
  expires: number;
  confirmedText?: string;
  startDate?: string;
  instructions?: Instruction[];
  model?: string;
  generating?: boolean;
  saved?: boolean;
}
const drafts = new Map<string, Draft>();
const draftLifetime = 30 * 60_000;
export interface Processing {
  recognize: (bytes: Buffer, extension: string) => Promise<string>;
  generate: (
    text: string,
    startDate: string,
    model?: string,
  ) => Promise<{ reminders: unknown[]; usedModel: string; demo?: boolean }>;
}
function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ApiError(400, "Неверный идентификатор.");
  return value;
}
// Lock the patient even when no plan exists, serializing first uploads/tasks.
async function lockPatient(patientId: string, client: PoolClient) {
  const { rows } = await client.query("SELECT id FROM patients WHERE id=$1 FOR UPDATE", [patientId]);
  if (!rows[0]) throw new ApiError(404, "Пациент не найден.");
}
export async function readPlan(
  patientId: string,
  client: { query: Function } = database(),
) {
  const { rows } = await client.query(
    "SELECT * FROM plans WHERE patient_id=$1",
    [patientId],
  );
  if (!rows[0]) return { plan: null, prescriptions: [], events: [] };
  const plan = rows[0];
  const prescriptions = (
    await client.query(
      "SELECT * FROM prescriptions WHERE plan_id=$1 ORDER BY created_at,id",
      [plan.id],
    )
  ).rows;
  const events = (
    await client.query(
      `SELECT e.*, p.title, p.instruction AS description FROM plan_events e JOIN prescriptions p ON p.id=e.prescription_id
    WHERE e.plan_id=$1 ORDER BY e.scheduled_date,e.scheduled_time NULLS LAST,e.occurrence_index,e.id`,
      [plan.id],
    )
  ).rows;
  return { plan, prescriptions, events };
}
export async function savedContext(patientId: string) {
  const snapshot = await readPlan(patientId);
  const active = snapshot.prescriptions
    .filter((p: any) => p.status === "active")
    .map((p: any) => `${p.title}: ${p.instruction}`)
    .join("\n\n");
  return [
    snapshot.plan?.procedure_name
      ? `Операция: ${snapshot.plan?.procedure_name}`
      : "",
    active ? `Действующие подтверждённые назначения:\n${active}` : "",
    snapshot.plan?.confirmed_instructions
      ? `Подтверждённые документы и решения пациента (история; отменённые назначения не действуют):\n${snapshot.plan.confirmed_instructions}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
function getDraft(id: unknown, patientId: string) {
  const draft = typeof id === "string" ? drafts.get(id) : undefined;
  if (!draft || draft.patientId !== patientId || draft.expires < Date.now())
    throw new ApiError(410, "Черновик истёк. Загрузите документ повторно.");
  return draft;
}
async function failUpload(draft: Draft, code: string) {
  await database().query(
    `UPDATE upload_records SET status='failed',error_code=$3,processed_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND attempt_count=$2 AND status='processing'`,
    [draft.uploadId, draft.attempt, code],
  );
}
// Expired drafts release only their own attempt. OCR text never enters PostgreSQL.
const cleanup = setInterval(() => {
  for (const [id, draft] of drafts)
    if (draft.expires < Date.now()) {
      drafts.delete(id);
      failUpload(draft, "draft_expired").catch(() => {});
    }
}, 60_000);
cleanup.unref();
function preview(instructions: Instruction[], prescriptions: any[]) {
  const active = prescriptions.filter((p) => p.status === "active");
  return instructions.map((item) => {
    const matching = active.filter(
      (p) =>
        normalize(p.title) === normalize(item.title) &&
        normalize(p.instruction) === normalize(item.instruction) &&
        p.starts_on &&
        p.ends_on &&
        p.starts_on <= item.endsOn &&
        p.ends_on >= item.startsOn,
    );
    const conflicts = active.filter(
      (p) => !matching.includes(p) && possibleConflict(item, p),
    );
    const incoming = instructions.filter(
      (other) => other.key !== item.key && possibleConflict(item, other),
    );
    return {
      key: item.key,
      title: item.title,
      instruction: item.instruction,
      events: item.events,
      matchingIds: matching.map((p) => p.id),
      conflicts: [
        ...conflicts.map((p) => ({
          id: p.id,
          title: p.title,
          instruction: p.instruction,
          startsOn: p.starts_on,
          endsOn: p.ends_on,
        })),
        ...incoming.map((other) => ({
          id: `incoming:${other.key}`,
          title: other.title,
          instruction: other.instruction,
          startsOn: other.startsOn,
          endsOn: other.endsOn,
        })),
      ],
      action: matching.length
        ? "extend"
        : conflicts.length
          ? "conflict"
          : "append",
    };
  });
}

export async function commitDraft(
  draft: Draft,
  expectedVersion: number,
  decisions: Record<string, string>,
) {
  if (draft.saved) return readPlan(draft.patientId);
  if (
    !draft.instructions ||
    !draft.confirmedText ||
    !draft.startDate ||
    !draft.model
  )
    throw new ApiError(
      409,
      "Сначала подтвердите текст и проверьте расписание.",
    );
  return transaction(async (client) => {
    await lockPatient(draft.patientId, client);
    const { rows: uploads } = await client.query(
      "SELECT * FROM upload_records WHERE id=$1 AND patient_id=$2 FOR UPDATE",
      [draft.uploadId, draft.patientId],
    );
    const upload = uploads[0];
    if (upload?.status === "completed")
      return readPlan(draft.patientId, client);
    if (
      !upload ||
      upload.attempt_count !== draft.attempt ||
      !["processing", "failed"].includes(upload.status) ||
      (upload.status === "failed" && upload.error_code !== "save_failed")
    )
      throw new ApiError(
        409,
        "Попытка обработки устарела. Повторите загрузку.",
      );
    if (upload.status === "failed")
      await client.query(
        "UPDATE upload_records SET status='processing',error_code=NULL,processed_at=NULL WHERE id=$1",
        [upload.id],
      );
    const before = await readPlan(draft.patientId, client);
    if (
      before.plan?.recovery_start_date &&
      before.plan.recovery_start_date !== draft.startDate
    )
      throw new ApiError(409, "Дата начала курса уже подтверждена.");
    if ((before.plan?.version ?? 0) !== expectedVersion)
      throw new ApiError(409, "План изменился. Повторно проверьте расписание.");
    const changes = preview(draft.instructions!, before.prescriptions);
    for (const change of changes)
      if (
        change.conflicts.length &&
        !["keep", "separate", "replace"].includes(decisions[change.key])
      )
        throw new ApiError(409, "Подтвердите решение для каждого конфликта.");
    let plan = before.plan;
    if (!plan)
      plan = (
        await client.query(
          `INSERT INTO plans(patient_id) VALUES($1) RETURNING *`,
          [draft.patientId],
        )
      ).rows[0];
    let changed = !before.plan;
    for (let index = 0; index < draft.instructions!.length; index++) {
      const item = draft.instructions![index],
        change = changes[index],
        choice = decisions[change.key];
      if (change.conflicts.length && choice === "keep") continue;
      if (
        choice === "replace" &&
        change.conflicts.some((c) => c.id.startsWith("incoming:"))
      )
        throw new ApiError(
          409,
          "Для конфликтующих новых назначений выберите отдельный курс или оставьте прежнее.",
        );
      if (change.conflicts.length && choice === "replace") {
        for (const conflict of change.conflicts) {
          await client.query(
            "UPDATE prescriptions SET status='superseded' WHERE id=$1 AND plan_id=$2",
            [conflict.id, plan.id],
          );
          await client.query(
            "UPDATE plan_events SET status='cancelled', completed_at=NULL WHERE prescription_id=$1 AND status='pending'",
            [conflict.id],
          );
        }
        changed = true;
      }
      const matched = before.prescriptions.find((p: any) =>
        change.matchingIds.includes(p.id),
      );
      let prescriptionId: string;
      if (matched) {
        prescriptionId = matched.id;
        const startsOn = [matched.starts_on, item.startsOn].sort()[0],
          endsOn = [matched.ends_on, item.endsOn].sort().at(-1)!;
        const times = [
          ...new Set([
            ...(matched.times_of_day || []).map((t: string) => t.slice(0, 5)),
            ...(item.times || []),
          ]),
        ].sort();
        const key = prescriptionKey({
          ...item,
          startsOn,
          endsOn,
          times: times.length ? times : null,
        });
        if (key !== matched.dedup_key) {
          await client.query(
            "UPDATE prescriptions SET starts_on=$2,ends_on=$3,times_of_day=$4,dedup_key=$5 WHERE id=$1",
            [
              prescriptionId,
              startsOn,
              endsOn,
              times.length ? times : null,
              key,
            ],
          );
          changed = true;
        }
      } else {
        const { rows } = await client.query(
          `INSERT INTO prescriptions(plan_id,title,instruction,starts_on,ends_on,times_of_day,dedup_key)
          VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            plan.id,
            item.title,
            item.instruction,
            item.startsOn,
            item.endsOn,
            item.times,
            item.key,
          ],
        );
        prescriptionId = rows[0].id;
        changed = true;
      }
      // A later upload can bridge two previously disjoint courses. Look across
      // every matching prescription so a shared event retains its original ID.
      const matchingIds = change.matchingIds.length
        ? change.matchingIds
        : [prescriptionId];
      const existing = (
        await client.query(
          "SELECT * FROM plan_events WHERE prescription_id=ANY($1::uuid[]) ORDER BY scheduled_date,occurrence_index",
          [matchingIds],
        )
      ).rows;
      const unknownCounts = new Map<string, number>();
      for (const event of item.events) {
        let found: boolean;
        if (event.time !== null)
          found = existing.some(
            (e) =>
              e.scheduled_date === event.date &&
              e.scheduled_time?.slice(0, 5) === event.time,
          );
        else {
          const nth = (unknownCounts.get(event.date) || 0) + 1;
          unknownCounts.set(event.date, nth);
          found =
            existing.filter(
              (e) =>
                e.scheduled_date === event.date && e.scheduled_time === null,
            ).length >= nth;
        }
        if (found) continue;
        const occurrence =
          1 +
          Math.max(
            0,
            ...existing
              .filter((e) => e.scheduled_date === event.date)
              .map((e) => e.occurrence_index),
          );
        if (occurrence > 32767)
          throw new ApiError(422, "Слишком много событий в один день.");
        const inserted = (
          await client.query(
            `INSERT INTO plan_events(plan_id,prescription_id,scheduled_date,scheduled_time,occurrence_index)
          VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [plan.id, prescriptionId, event.date, event.time, occurrence],
          )
        ).rows[0];
        existing.push(inserted);
        changed = true;
      }
    }
    // Preserve the complete confirmed document, including instructions without
    // events. Explicit conflict decisions accompany it so rejected/superseded
    // instructions remain historical rather than becoming active prescriptions.
    const resolutions = changes
      .filter((c) => c.conflicts.length)
      .map((c) => {
        const choice = decisions[c.key];
        return choice === "keep"
          ? `Пациент оставил прежнее назначение; новое «${c.title}: ${c.instruction}» не применяется.`
          : choice === "replace"
            ? `Пациент подтвердил замену назначения «${c.title}». Прежние назначения отменены для невыполненных задач.`
            : `Пациент подтвердил «${c.title}: ${c.instruction}» как отдельный курс.`;
      });
    const accepted = [draft.confirmedText, ...resolutions].join("\n\n");
    const previous = plan.confirmed_instructions || "";
    const full =
      accepted &&
      !previous
        .split("\n\n--- Подтверждённое дополнение ---\n\n")
        .some((block: string) => normalize(block) === normalize(accepted))
        ? [previous, accepted]
            .filter(Boolean)
            .join("\n\n--- Подтверждённое дополнение ---\n\n")
        : previous;
    if (full !== previous) changed = true;
    if (changed)
      await client.query(
        `UPDATE plans SET status='confirmed',confirmed_at=COALESCE(confirmed_at,CURRENT_TIMESTAMP),
      confirmed_instructions=$2,generated_by_model=$3,version=version+$4 WHERE id=$1`,
        [plan.id, full, draft.model, before.plan ? 1 : 0],
      );
    await client.query(
      "UPDATE plans SET recovery_start_date=COALESCE(recovery_start_date,$2) WHERE patient_id=$1",
      [draft.patientId, draft.startDate],
    );
    await client.query(
      "UPDATE upload_records SET status='completed',error_code=NULL,processed_at=CURRENT_TIMESTAMP WHERE id=$1",
      [draft.uploadId],
    );
    return readPlan(draft.patientId, client);
  });
}

export function recoveryRouter(processing: Processing) {
  const router = Router();
  router.use(authenticate);
  router.patch(
    "/patient",
    wrap(async (req, res) => {
      const name = username(req.body.username);
      const { rows } = await database().query(
        "UPDATE patients SET username=$2 WHERE id=$1 RETURNING id,username,email,phone,timezone",
        [res.locals.patient.id, name],
      );
      res.json({ patient: rows[0] });
    }),
  );
  router.get(
    "/plan",
    wrap(async (_req, res) => {
      res.json(await readPlan(res.locals.patient.id));
    }),
  );
  router.get(
    "/plan/events",
    wrap(async (req, res) => {
      const from = req.query.from || localToday(res.locals.patient.timezone),
        to = req.query.to || from;
      if (!validDate(from) || !validDate(to) || from > to)
        throw new ApiError(400, "Неверный диапазон дат.");
      const { rows } = await database().query(
        `SELECT e.*,p.title,p.instruction AS description FROM plan_events e JOIN prescriptions p ON p.id=e.prescription_id
      JOIN plans pl ON pl.id=e.plan_id WHERE pl.patient_id=$1 AND e.scheduled_date BETWEEN $2 AND $3 ORDER BY scheduled_date,scheduled_time NULLS LAST,occurrence_index`,
        [res.locals.patient.id, from, to],
      );
      res.json({ events: rows });
    }),
  );
  router.patch(
    "/events/:eventId",
    wrap(async (req, res) => {
      if (typeof req.body.completed !== "boolean")
        throw new ApiError(400, "Укажите completed.");
      const { rows } = await database().query(
        `UPDATE plan_events e SET status=CASE WHEN $3 THEN 'completed' ELSE 'pending' END,
      completed_at=CASE WHEN $3 THEN COALESCE(e.completed_at,CURRENT_TIMESTAMP) ELSE NULL END
      FROM plans pl WHERE e.id=$1 AND e.plan_id=pl.id AND pl.patient_id=$2
      AND e.status IN ('pending','completed') RETURNING e.*`,
        [uuid(req.params.eventId), res.locals.patient.id, req.body.completed],
      );
      if (!rows[0]) throw new ApiError(404, "Задача не найдена или отменена.");
      res.json({ event: rows[0] });
    }),
  );
  router.post(
    "/plan/tasks",
    wrap(async (req, res) => {
      const date = req.body.date;
      if (
        typeof req.body.text !== "string" ||
        !req.body.text.trim() ||
        req.body.text.length > 10000
      )
        throw new ApiError(
          400,
          "Задача должна содержать от 1 до 10000 символов.",
        );
      const text = req.body.text.trim();
      if (!validDate(date)) throw new ApiError(400, "Укажите дату задачи.");
      const patientId = res.locals.patient.id;
      const result = await transaction(async (client) => {
        await lockPatient(patientId, client);
        let plan = (
          await client.query("SELECT * FROM plans WHERE patient_id=$1", [
            patientId,
          ])
        ).rows[0];
        if (!plan)
          plan = (
            await client.query(
              "INSERT INTO plans(patient_id,status,confirmed_at) VALUES($1,'confirmed',CURRENT_TIMESTAMP) RETURNING *",
              [patientId],
            )
          ).rows[0];
        const item = adaptReminders([
          { title: text, description: text, date, time: null },
        ])[0];
        const { rows } = await client.query(
          `INSERT INTO prescriptions(plan_id,title,instruction,starts_on,ends_on,dedup_key)
        VALUES($1,$2,$2,$3,$3,$4) ON CONFLICT(plan_id,dedup_key) WHERE status='active' DO UPDATE SET title=prescriptions.title RETURNING id`,
          [plan.id, text, date, item.key],
        );
        await client.query(
          "INSERT INTO plan_events(plan_id,prescription_id,scheduled_date) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [plan.id, rows[0].id, date],
        );
        await client.query("UPDATE plans SET version=version+1 WHERE id=$1", [
          plan.id,
        ]);
        return readPlan(patientId, client);
      });
      res.json(result);
    }),
  );
  router.post(
    "/ocr",
    wrap(async (req, res) => {
      const patientId = res.locals.patient.id;
      const extension = String(req.query.extension || "").toLowerCase();
      if (
        !["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp"].includes(extension)
      )
        throw new ApiError(400, "Выберите PDF или изображение.");
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new ApiError(400, "Загруженный файл пуст.");
      const hash = sha256(req.body);
      const claim = await transaction(async (client) => {
        await lockPatient(patientId, client);
        const { rows } = await client.query(
          "SELECT * FROM upload_records WHERE patient_id=$1 AND file_sha256=$2 FOR UPDATE",
          [patientId, hash],
        );
        const old = rows[0];
        if (old?.status === "completed") return { existing: true };
        if (
          old?.status === "processing" &&
          Date.now() - new Date(old.updated_at).getTime() < draftLifetime
        )
          throw new ApiError(
            409,
            "Документ уже обрабатывается или ожидает подтверждения.",
          );
        const upload = old
          ? (
              await client.query(
                `UPDATE upload_records SET status='processing',processed_at=NULL,error_code=NULL,attempt_count=attempt_count+1 WHERE id=$1 RETURNING *`,
                [old.id],
              )
            ).rows[0]
          : (
              await client.query(
                "INSERT INTO upload_records(patient_id,file_sha256) VALUES($1,$2) RETURNING *",
                [patientId, hash],
              )
            ).rows[0];
        return { existing: false, upload };
      });
      if (claim.existing) {
        res.json({ existing: true, ...(await readPlan(patientId)) });
        return;
      }
      const draft: Draft = {
        id: randomBytes(32).toString("hex"),
        patientId,
        uploadId: claim.upload.id,
        attempt: claim.upload.attempt_count,
        text: "",
        expires: Date.now() + draftLifetime,
      };
      try {
        draft.text = await processing.recognize(req.body, extension);
        if (!draft.text.trim())
          throw new ApiError(422, "В документе не найден текст.");
        drafts.set(draft.id, draft);
        res.json({ text: draft.text, draftId: draft.id });
      } catch (error) {
        await failUpload(draft, "ocr_failed");
        throw error;
      }
    }),
  );
  router.delete(
    "/drafts/:draftId",
    wrap(async (req, res) => {
      const draft = getDraft(req.params.draftId, res.locals.patient.id);
      await failUpload(draft, "cancelled");
      drafts.delete(draft.id);
      res.json({ ok: true });
    }),
  );
  router.post(
    "/generate-schedule",
    wrap(async (req, res) => {
      const draft = getDraft(req.body.draftId, res.locals.patient.id);
      const snapshot = await readPlan(draft.patientId);
      const startDate = snapshot.plan?.recovery_start_date || req.body.startDate;
      if (!validDate(startDate))
        throw new ApiError(400, "Подтвердите дату начала курса.");
      if (
        snapshot.plan?.recovery_start_date &&
        req.body.startDate &&
        req.body.startDate !== startDate
      )
        throw new ApiError(409, "Дата начала курса уже зафиксирована.");
      const text = req.body.confirmedText;
      if (typeof text !== "string" || !text.trim() || text.length > 100000)
        throw new ApiError(400, "Подтвердите текст рекомендаций.");
      if (draft.generating)
        throw new ApiError(409, "Расписание уже формируется.");
      draft.generating = true;
      try {
        await transaction(async (client) => {
          await lockPatient(draft.patientId, client);
          const { rows } = await client.query(
            "SELECT * FROM upload_records WHERE id=$1 FOR UPDATE",
            [draft.uploadId],
          );
          const upload = rows[0];
          if (
            !upload ||
            upload.attempt_count !== draft.attempt ||
            upload.status === "completed"
          )
            throw new ApiError(409, "Попытка обработки устарела.");
          if (upload.status === "failed") {
            const { rows: retried } = await client.query(
              "UPDATE upload_records SET status='processing',processed_at=NULL,error_code=NULL,attempt_count=attempt_count+1 WHERE id=$1 RETURNING attempt_count",
              [draft.uploadId],
            );
            draft.attempt = retried[0].attempt_count;
          }
        });
        if (
          !draft.instructions ||
          draft.confirmedText !== text.trim() ||
          draft.startDate !== startDate
        ) {
          const result = await processing.generate(
            [
              snapshot.plan?.procedure_name
                ? `Операция: ${snapshot.plan?.procedure_name}`
                : "",
              text.trim(),
            ]
              .filter(Boolean)
              .join("\n\n"),
            startDate,
            req.body.model,
          );
          if (result.demo || result.usedModel.includes("(демо-валидатор)"))
            throw new ApiError(
              503,
              "Демо-расписание не сохраняется. Настройте GigaChat.",
            );
          draft.instructions = adaptReminders(result.reminders);
          draft.model = result.usedModel;
          draft.confirmedText = text.trim();
          draft.startDate = startDate;
        }
        const saved = await readPlan(draft.patientId);
        res.json({
          draftId: draft.id,
          version: saved.plan?.version ?? 0,
          startDate,
          usedModel: draft.model,
          changes: preview(draft.instructions, saved.prescriptions),
        });
      } catch (error) {
        await failUpload(draft, "generation_failed");
        throw error;
      } finally {
        draft.generating = false;
      }
    }),
  );
  router.post(
    "/plans/confirm",
    wrap(async (req, res) => {
      const draft = getDraft(req.body.draftId, res.locals.patient.id);
      if (!Number.isInteger(req.body.version) || req.body.version < 0)
        throw new ApiError(400, "Неверная версия плана.");
      const decisions = req.body.decisions;
      if (
        decisions != null &&
        (typeof decisions !== "object" || Array.isArray(decisions))
      )
        throw new ApiError(400, "Неверные решения по конфликтам.");
      try {
        res.json(
          await commitDraft({ ...draft }, req.body.version, decisions || {}),
        );
      } catch (error) {
        if (!(error instanceof ApiError))
          await failUpload(draft, "save_failed");
        throw error;
      }
      // Retain only a short-lived metadata tombstone for double-click retries.
      draft.saved = true;
      draft.text = "";
      draft.confirmedText = "";
      draft.instructions = undefined;
    }),
  );
  return router;
}
