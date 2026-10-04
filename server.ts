import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import https from "https";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

let cachedToken: { token: string; expiresAt: number } | null = null;

// =====================================================================
// 1. ХРАНИЛИЩЕ БАЗЫ ДАННЫХ (users, protocols, schedule)
// =====================================================================

export type ProcStatus = "waiting" | "skipped" | "performed";

export interface DbUser {
  id: number;
  phone: string;
  login: string;
  password_hash: string;
  registered_at: string;
  last_login_at: string | null;
}

export interface DbProtocol {
  id: number;
  user_id: number;
  raw_text: string;
  protocol: {
    start_date: string;
    model: string;
    rules: RuleItem[];
    total_reminders: number;
  };
  uploaded_at: string;
}

export interface DbScheduleItem {
  id: number;
  user_id: number;
  protocol_id: number | null;
  procedure: string;
  description: string;
  time_to_do: string;
  date: string;
  time: string;
  proc_status: ProcStatus;
}

interface DatabaseSchema {
  nextUserId: number;
  nextProtocolId: number;
  nextScheduleId: number;
  users: DbUser[];
  protocols: DbProtocol[];
  schedule: DbScheduleItem[];
}

const DB_FILE_PATH = path.join(process.cwd(), "local_db.json");

function hashPassword(password: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, actualSalt, 100_000, 32, "sha256")
    .toString("hex");
  return `pbkdf2_sha256$${actualSalt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes("$")) return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3) return false;
  const salt = parts[1];
  const expected = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(storedHash));
}

function loadDb(): DatabaseSchema {
  try {
    if (fs.existsSync(DB_FILE_PATH)) {
      const raw = fs.readFileSync(DB_FILE_PATH, "utf-8");
      const parsed = JSON.parse(raw) as DatabaseSchema;
      if (parsed && Array.isArray(parsed.users)) {
        return parsed;
      }
    }
  } catch {
    // ignore and initialize fresh DB
  }

  const nowIso = new Date().toISOString();
  const initialDb: DatabaseSchema = {
    nextUserId: 2,
    nextProtocolId: 1,
    nextScheduleId: 1,
    users: [
      {
        id: 1,
        phone: "+79991234567",
        login: "ivan_petrov",
        password_hash: hashPassword("123456"),
        registered_at: nowIso,
        last_login_at: nowIso,
      },
    ],
    protocols: [],
    schedule: [],
  };
  saveDb(initialDb);
  return initialDb;
}

function saveDb(db: DatabaseSchema): void {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist DB:", err);
  }
}

const dbState: DatabaseSchema = loadDb();

function sanitizeUser(u: DbUser) {
  return {
    id: u.id,
    phone: u.phone,
    login: u.login,
    password_hash: u.password_hash,
    registered_at: u.registered_at,
    last_login_at: u.last_login_at,
  };
}

function getUserProtocols(userId: number): DbProtocol[] {
  return dbState.protocols
    .filter((p) => p.user_id === userId)
    .sort((a, b) => b.id - a.id);
}

function getUserSchedule(userId: number): DbScheduleItem[] {
  return dbState.schedule
    .filter((s) => s.user_id === userId)
    .sort((a, b) =>
      `${a.date} ${a.time} ${a.id}`.localeCompare(`${b.date} ${b.time} ${b.id}`)
    );
}

// =====================================================================
// 2. GIGACHAT API И ВАЛИДАЦИЯ ПРОТОКОЛОВ / РАСПИСАНИЯ
// =====================================================================

function resolveGigaChatCredentials(): string | null {
  const credentials = process.env.GIGACHAT_CREDENTIALS?.trim();
  if (credentials && credentials !== "YOUR_GIGACHAT_AUTH_KEY") {
    return credentials.replace(/^basic\s+/i, "").trim();
  }

  const clientId = process.env.GIGACHAT_CLIENT_ID?.trim();
  const clientSecret = process.env.GIGACHAT_CLIENT_SECRET?.trim();
  if (clientId && clientSecret && clientId !== "YOUR_CLIENT_ID") {
    return Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64");
  }

  return null;
}

async function getGigaChatToken(credentials: string, scope: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  return new Promise((resolve, reject) => {
    const postData = `scope=${encodeURIComponent(scope)}`;
    const req = https.request(
      "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      {
        method: "POST",
        agent: httpsAgent,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          RqUID: crypto.randomUUID(),
          Authorization: `Basic ${credentials}`,
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && data.access_token) {
              cachedToken = {
                token: data.access_token,
                expiresAt: data.expires_at || Date.now() + 25 * 60 * 1000,
              };
              resolve(data.access_token);
            } else {
              reject(new Error(data.message || `OAuth ошибка (${res.statusCode}): ${raw}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function callSingleGigaChatModel(
  token: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature = 0.2
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages,
      temperature,
    });

    const req = https.request(
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
      {
        method: "POST",
        agent: httpsAgent,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const reply = data.choices?.[0]?.message?.content || "";
              resolve(reply);
            } else {
              reject(new Error(data.message || `GigaChat API ошибка (${res.statusCode}): ${raw}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function callGigaChatWithFallback(
  token: string,
  messages: Array<{ role: string; content: string }>,
  preferredModel = "GigaChat-Pro",
  temperature = 0.2
): Promise<{ reply: string; usedModel: string }> {
  const modelsToTry = [preferredModel];
  if (preferredModel !== "GigaChat") {
    modelsToTry.push("GigaChat");
  }

  let lastErr: unknown = null;
  for (const currentModel of modelsToTry) {
    try {
      const reply = await callSingleGigaChatModel(token, currentModel, messages, temperature);
      return { reply, usedModel: currentModel };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function addDays(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ReminderItem {
  date: string;
  time: string;
  title: string;
  description: string;
}

export interface RuleItem {
  title: string;
  description: string;
  times: string[];
  exact_date?: string;
  start_offset_days: number;
  duration_days: number;
  interval_days: number;
}

function normalizeTime(timeStr: string): string {
  const match = String(timeStr || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "09:00";
  const hh = Math.min(23, Math.max(0, Number(match[1])));
  const mm = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function isValidIsoDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`));
}

function expandAndValidateSchedule(
  rawText: string,
  startDate: string
): { rules: RuleItem[]; reminders: ReminderItem[] } {
  const cleaned = rawText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("В ответе модели не найден JSON-объект");
  }
  const jsonStr = match[0].replace(/,\s*([}\]])/g, "$1");
  const parsed = JSON.parse(jsonStr) as {
    rules?: RuleItem[];
    reminders?: ReminderItem[];
  };

  const results: ReminderItem[] = [];
  const normalizedRules: RuleItem[] = [];

  if (Array.isArray(parsed.reminders)) {
    for (const item of parsed.reminders) {
      if (item && item.title && item.description && isValidIsoDate(String(item.date || ""))) {
        results.push({
          date: String(item.date).trim(),
          time: normalizeTime(item.time),
          title: String(item.title).trim(),
          description: String(item.description).trim(),
        });
      }
    }
  }

  if (Array.isArray(parsed.rules)) {
    for (const rule of parsed.rules) {
      if (!rule || !rule.title || !rule.description) continue;
      const startOffset = Math.max(0, Math.min(365, Number(rule.start_offset_days ?? 0)));
      const durationDays = Math.max(1, Math.min(180, Number(rule.duration_days ?? 1)));
      const intervalDays = Math.max(1, Math.min(90, Number(rule.interval_days ?? 1)));
      const rawTimes = Array.isArray(rule.times) && rule.times.length > 0 ? rule.times : ["09:00"];
      const times = rawTimes.map((t) => normalizeTime(t));

      normalizedRules.push({
        title: String(rule.title).trim(),
        description: String(rule.description).trim(),
        times,
        start_offset_days: startOffset,
        duration_days: durationDays,
        interval_days: intervalDays,
      });

      const ruleBaseDate =
        rule.exact_date && isValidIsoDate(rule.exact_date)
          ? rule.exact_date
          : addDays(startDate, startOffset);

      for (let d = 0; d < durationDays; d += intervalDays) {
        const concreteDate = addDays(ruleBaseDate, d);
        for (const t of times) {
          results.push({
            date: concreteDate,
            time: t,
            title: String(rule.title).trim(),
            description: String(rule.description).trim(),
          });
        }
      }
    }
  }

  if (results.length === 0) {
    throw new Error("Список напоминаний после валидации пуст");
  }

  const uniqueMap = new Map<string, ReminderItem>();
  for (const r of results) {
    uniqueMap.set(`${r.date}|${r.time}|${r.title}`, r);
  }

  const finalReminders = Array.from(uniqueMap.values());
  finalReminders.sort((a, b) =>
    `${a.date} ${a.time} ${a.title}`.localeCompare(`${b.date} ${b.time} ${b.title}`)
  );
  return { rules: normalizedRules, reminders: finalReminders };
}

function buildFallbackSchedule(startDate: string): {
  rules: RuleItem[];
  reminders: ReminderItem[];
} {
  const defaultRulesJson = JSON.stringify({
    rules: [
      {
        title: "Кальций Д3 Никомед",
        description: "Принять 1 таблетку во время еды (курс 2 месяца)",
        times: ["09:00", "20:00"],
        start_offset_days: 0,
        duration_days: 60,
        interval_days: 1,
      },
      {
        title: "Кеторол",
        description: "Принять 1 таблетку в 13:00 при болях (первые 3 дня)",
        times: ["13:00"],
        start_offset_days: 0,
        duration_days: 3,
        interval_days: 1,
      },
      {
        title: "Перевязка и обработка шва",
        description: "Обработать послеоперационный шов антисептиком и сменить стерильную повязку",
        times: ["11:00"],
        start_offset_days: 2,
        duration_days: 10,
        interval_days: 2,
      },
      {
        title: "Снятие повязки и швов",
        description: "Посетить перевязочный кабинет для снятия послеоперационных швов",
        times: ["10:00"],
        start_offset_days: 10,
        duration_days: 1,
        interval_days: 1,
      },
      {
        title: "Плановый приём травматолога",
        description: "Контрольный рентген-снимок и осмотр у лечащего врача-травматолога",
        times: ["14:00"],
        start_offset_days: 14,
        duration_days: 1,
        interval_days: 1,
      },
    ],
  });
  return expandAndValidateSchedule(defaultRulesJson, startDate);
}

// =====================================================================
// 3. EXPRESS СЕРВЕР И REST API
// =====================================================================

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Список файлов для вкладки «Код для GitHub (Python + SQL)»
  app.get("/api/files", (_req, res) => {
    const fileNames = [
      "schema.sql",
      "db.py",
      "app.py",
      "requirements.txt",
      ".env.example",
      "README.md",
    ];
    const files: Record<string, string> = {};
    for (const name of fileNames) {
      try {
        files[name] = fs.readFileSync(path.join(process.cwd(), name), "utf-8");
      } catch {
        files[name] = "";
      }
    }
    res.json({
      files,
      hasGigaChatKey: Boolean(resolveGigaChatCredentials()),
    });
  });

  // Регистрация нового пользователя в таблицу `users`
  app.post("/api/auth/register", (req, res) => {
    const { login, phone, password } = req.body as {
      login?: string;
      phone?: string;
      password?: string;
    };

    const cleanLogin = String(login || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanLogin || !cleanPhone || !cleanPassword) {
      res.status(400).json({ error: "Заполните логин, телефон и пароль" });
      return;
    }
    if (cleanLogin.length > 50) {
      res.status(400).json({ error: "Логин не должен превышать 50 символов" });
      return;
    }
    if (cleanPhone.length > 20) {
      res.status(400).json({ error: "Телефон не должен превышать 20 символов" });
      return;
    }

    const existing = dbState.users.find(
      (u) =>
        u.login.toLowerCase() === cleanLogin.toLowerCase() ||
        u.phone === cleanPhone
    );
    if (existing) {
      res.status(409).json({
        error: "Пользователь с таким логином или телефоном уже зарегистрирован",
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const newUser: DbUser = {
      id: dbState.nextUserId++,
      phone: cleanPhone,
      login: cleanLogin,
      password_hash: hashPassword(cleanPassword),
      registered_at: nowIso,
      last_login_at: nowIso,
    };

    dbState.users.push(newUser);
    saveDb(dbState);

    res.json({
      user: sanitizeUser(newUser),
      protocols: [],
      schedule: [],
    });
  });

  // Вход пользователя по логину или телефону
  app.post("/api/auth/login", (req, res) => {
    const { loginOrPhone, password } = req.body as {
      loginOrPhone?: string;
      password?: string;
    };

    const identifier = String(loginOrPhone || "").trim();
    const cleanPassword = String(password || "");

    if (!identifier || !cleanPassword) {
      res.status(400).json({ error: "Введите логин (или телефон) и пароль" });
      return;
    }

    const user = dbState.users.find(
      (u) =>
        u.login.toLowerCase() === identifier.toLowerCase() ||
        u.phone === identifier
    );

    if (!user || !verifyPassword(cleanPassword, user.password_hash)) {
      res.status(401).json({ error: "Неверный логин/телефон или пароль" });
      return;
    }

    user.last_login_at = new Date().toISOString();
    saveDb(dbState);

    res.json({
      user: sanitizeUser(user),
      protocols: getUserProtocols(user.id),
      schedule: getUserSchedule(user.id),
    });
  });

  // Получение данных авторизованного пользователя (профиль, протоколы, расписание)
  app.get("/api/user/:userId/data", (req, res) => {
    const userId = Number(req.params.userId);
    const user = dbState.users.find((u) => u.id === userId);
    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }
    res.json({
      user: sanitizeUser(user),
      protocols: getUserProtocols(user.id),
      schedule: getUserSchedule(user.id),
    });
  });

  // Сводка состояния таблиц БД (users, protocols, schedule)
  app.get("/api/db/overview", (_req, res) => {
    res.json({
      users: dbState.users.map(sanitizeUser),
      protocols: dbState.protocols,
      schedule: dbState.schedule,
    });
  });

  // Загрузка протокола -> валидация JSON -> сохранение в `protocols` и `schedule`
  app.post("/api/generate-schedule", async (req, res) => {
    const { userId, recommendationsText, startDate, model } = req.body as {
      userId?: number;
      recommendationsText?: string;
      startDate?: string;
      model?: string;
    };

    const targetUserId = Number(userId || 1);
    const user = dbState.users.find((u) => u.id === targetUserId);
    if (!user) {
      res.status(401).json({ error: "Необходимо войти в систему для сохранения протокола и расписания" });
      return;
    }

    const baseDate = startDate || new Date().toISOString().slice(0, 10);
    const preferredModel = model || process.env.GIGACHAT_MODEL || "GigaChat-Pro";
    const credentials = resolveGigaChatCredentials();
    const scope = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";

    let extractedRules: RuleItem[] = [];
    let expandedReminders: ReminderItem[] = [];
    let usedModel = `${preferredModel} (демо-валидатор)`;

    if (credentials) {
      try {
        const token = await getGigaChatToken(credentials, scope);
        const prompt = `Ты — медицинский ИИ-ассистент. Пациент после операции при переломе прикрепил список рекомендаций врача.
Дата начала отсчёта (сегодня): ${baseDate}.

Извлеки ВСЕ рекомендации (приём лекарств, кальция, перевязки, снятие повязок/швов, плановый приём врача) в структурированный JSON с массивом "rules", чтобы длительные курсы (например, на 2 месяца = 60 дней) развернулись на каждый день календаря:
{
  "rules": [
    {
      "title": "Кальций Д3 Никомед",
      "description": "Принять 1 таблетку во время еды (курс 2 месяца)",
      "times": ["09:00", "20:00"],
      "start_offset_days": 0,
      "duration_days": 60,
      "interval_days": 1
    }
  ]
}

Список рекомендаций пациента:
${recommendationsText || ""}`;

        const gigaResult = await callGigaChatWithFallback(
          token,
          [{ role: "user", content: prompt }],
          preferredModel,
          0.1
        );
        const validated = expandAndValidateSchedule(gigaResult.reply, baseDate);
        extractedRules = validated.rules;
        expandedReminders = validated.reminders;
        usedModel = gigaResult.usedModel;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: `Ошибка генерации расписания: ${message}` });
        return;
      }
    } else {
      const fallback = buildFallbackSchedule(baseDate);
      extractedRules = fallback.rules;
      expandedReminders = fallback.reminders;
    }

    const nowIso = new Date().toISOString();

    // 1. Сохраняем протокол в таблицу `protocols`
    const newProtocol: DbProtocol = {
      id: dbState.nextProtocolId++,
      user_id: user.id,
      raw_text: String(recommendationsText || "").trim(),
      protocol: {
        start_date: baseDate,
        model: usedModel,
        rules: extractedRules,
        total_reminders: expandedReminders.length,
      },
      uploaded_at: nowIso,
    };
    dbState.protocols.push(newProtocol);

    // 2. Сохраняем все записи расписания в таблицу `schedule`
    for (const item of expandedReminders) {
      const scheduleRow: DbScheduleItem = {
        id: dbState.nextScheduleId++,
        user_id: user.id,
        protocol_id: newProtocol.id,
        procedure: item.title.slice(0, 255),
        description: item.description,
        time_to_do: `${item.date}T${item.time}:00+00:00`,
        date: item.date,
        time: item.time,
        proc_status: "waiting",
      };
      dbState.schedule.push(scheduleRow);
    }

    saveDb(dbState);

    res.json({
      protocol: newProtocol,
      protocols: getUserProtocols(user.id),
      schedule: getUserSchedule(user.id),
      reminders: getUserSchedule(user.id),
      usedModel,
    });
  });

  // Обновление статуса процедуры в таблице `schedule` (waiting / skipped / performed)
  app.patch("/api/schedule/:scheduleId/status", (req, res) => {
    const scheduleId = Number(req.params.scheduleId);
    const { userId, proc_status } = req.body as {
      userId?: number;
      proc_status?: ProcStatus;
    };

    if (!proc_status || !["waiting", "skipped", "performed"].includes(proc_status)) {
      res.status(400).json({ error: "Недопустимый статус (waiting, skipped, performed)" });
      return;
    }

    const row = dbState.schedule.find(
      (s) => s.id === scheduleId && (!userId || s.user_id === Number(userId))
    );
    if (!row) {
      res.status(404).json({ error: "Запись расписания не найдена" });
      return;
    }

    row.proc_status = proc_status;
    saveDb(dbState);

    res.json({
      item: row,
      schedule: getUserSchedule(row.user_id),
    });
  });

  // Диалог с пациентом
  app.post("/api/chat", async (req, res) => {
    const { messages, recommendationsText, model } = req.body as {
      messages?: Array<{ role: string; content: string }>;
      recommendationsText?: string;
      model?: string;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Некорректный формат сообщений" });
      return;
    }

    const preferredModel = model || process.env.GIGACHAT_MODEL || "GigaChat-Pro";
    const credentials = resolveGigaChatCredentials();
    const scope = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";

    if (!credentials) {
      res.json({
        reply:
          "Демо-режим предпросмотра: ваш протокол (JSON) и расписание сохранены в базу данных. При запуске локально (`streamlit run app.py`) с вашим `.env` используется выбранная модель GigaChat-Pro / GigaChat и PostgreSQL (`schema.sql`).",
      });
      return;
    }

    try {
      const token = await getGigaChatToken(credentials, scope);
      const contextNote = recommendationsText
        ? `\nПрикреплённые рекомендации пациента из БД:\n${recommendationsText}`
        : "";
      const systemPrompt = {
        role: "system",
        content:
          "Ты — медицинский цифровой помощник по послеоперационному сопровождению пациентов с переломами. Отвечай вежливо, кратко и понятно." +
          contextNote,
      };
      const { reply } = await callGigaChatWithFallback(
        token,
        [systemPrompt, ...messages],
        preferredModel,
        0.5
      );
      res.json({ reply });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Ошибка обращения к GigaChat: ${message}` });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
