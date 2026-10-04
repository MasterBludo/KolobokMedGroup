import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import https from "https";
import crypto from "crypto";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { parseScheduleJson } from "./schedule-json";

dotenv.config();

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

let cachedToken: { token: string; expiresAt: number } | null = null;

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

interface ReminderItem {
  date: string;
  time: string;
  title: string;
  description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTime(timeValue: unknown): string {
  const match = String(timeValue || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "09:00";
  const hh = Math.min(23, Math.max(0, Number(match[1])));
  const mm = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function isValidIsoDate(dateStr: unknown): dateStr is string {
  return (
    typeof dateStr === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateStr) &&
    !Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`))
  );
}

function expandAndValidateSchedule(rawText: string, startDate: string): ReminderItem[] {
  const parsed = parseScheduleJson(rawText);

  const results: ReminderItem[] = [];

  if (Array.isArray(parsed.reminders)) {
    for (const rawItem of parsed.reminders) {
      if (
        isRecord(rawItem) &&
        typeof rawItem.title === "string" &&
        rawItem.title.trim() &&
        typeof rawItem.description === "string" &&
        rawItem.description.trim() &&
        isValidIsoDate(rawItem.date)
      ) {
        results.push({
          date: rawItem.date.trim(),
          time: normalizeTime(rawItem.time),
          title: rawItem.title.trim(),
          description: rawItem.description.trim(),
        });
      }
    }
  }

  if (Array.isArray(parsed.rules)) {
    for (const rawRule of parsed.rules) {
      if (
        !isRecord(rawRule) ||
        typeof rawRule.title !== "string" ||
        !rawRule.title.trim() ||
        typeof rawRule.description !== "string" ||
        !rawRule.description.trim()
      ) {
        continue;
      }
      const startOffset = Math.max(0, Math.min(365, Number(rawRule.start_offset_days ?? 0)));
      const durationDays = Math.max(1, Math.min(180, Number(rawRule.duration_days ?? 1)));
      const intervalDays = Math.max(1, Math.min(90, Number(rawRule.interval_days ?? 1)));
      const times =
        Array.isArray(rawRule.times) && rawRule.times.length > 0
          ? rawRule.times.filter((time): time is string => typeof time === "string")
          : ["09:00"];
      const validTimes = times.length > 0 ? times : ["09:00"];

      const ruleBaseDate =
        isValidIsoDate(rawRule.exact_date)
          ? rawRule.exact_date
          : addDays(startDate, startOffset);

      for (let d = 0; d < durationDays; d += intervalDays) {
        const concreteDate = addDays(ruleBaseDate, d);
        for (const t of validTimes) {
          results.push({
            date: concreteDate,
            time: normalizeTime(t),
            title: rawRule.title.trim(),
            description: rawRule.description.trim(),
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
  return finalReminders;
}

function buildFallbackReminders(startDate: string): ReminderItem[] {
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/files", (_req, res) => {
    const fileNames = ["README.md", "app.py", "requirements.txt", ".env.example"];
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

  app.post(
    "/api/ocr",
    express.raw({ type: "application/octet-stream", limit: "20mb" }),
    async (req, res) => {
      const extension = String(req.query.extension || "").toLowerCase();
      const allowedExtensions = new Set(["pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp"]);
      if (!allowedExtensions.has(extension)) {
        res.status(400).json({ error: "Выберите PDF-файл или изображение." });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Загруженный файл пуст или не распознан." });
        return;
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolobok-ocr-"));
      const filePath = path.join(tempDir, `statement.${extension}`);
      try {
        fs.writeFileSync(filePath, req.body);
        const scriptPath = path.join(process.cwd(), "ocrtest.py");
        const text = await new Promise<string>((resolve, reject) => {
          const python = spawn(
            process.env.PYTHON_EXECUTABLE || "python",
            [scriptPath, "--text-only", filePath],
            {
              windowsHide: true,
              env: {
                ...process.env,
                PYTHONIOENCODING: "utf-8",
                PYTHONUTF8: "1",
              },
            }
          );
          let output = "";
          let errorOutput = "";
          python.stdout.setEncoding("utf8");
          python.stderr.setEncoding("utf8");
          python.stdout.on("data", (chunk: string) => (output += chunk));
          python.stderr.on("data", (chunk: string) => (errorOutput += chunk));
          python.on("error", reject);
          python.on("close", (code) => {
            if (code === 0) {
              resolve(output.trim());
            } else {
              reject(new Error(errorOutput.trim() || `OCR завершился с кодом ${code}`));
            }
          });
        });
        res.json({ text });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: `Не удалось распознать документ: ${message}` });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  );

  app.post("/api/generate-schedule", async (req, res) => {
    const { recommendationsText, startDate, model } = req.body as {
      recommendationsText?: string;
      startDate?: string;
      model?: string;
    };

    const baseDate = startDate || new Date().toISOString().slice(0, 10);
    const preferredModel = model || process.env.GIGACHAT_MODEL || "GigaChat-Pro";
    const credentials = resolveGigaChatCredentials();
    const scope = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";

    if (!credentials) {
      res.json({
        reminders: buildFallbackReminders(baseDate),
        usedModel: `${preferredModel} (демо-валидатор)`,
      });
      return;
    }

    try {
      const token = await getGigaChatToken(credentials, scope);
      const prompt = `Ты — медицинский ИИ-ассистент. Пациент после операции при переломе прикрепил список рекомендаций врача.
Дата начала отсчёта (сегодня): ${baseDate}.

Извлеки ВСЕ рекомендации (приём лекарств, кальция, перевязки, снятие повязок/швов, плановый приём врача) в структурированный JSON с массивом "rules", чтобы длительные курсы (например, на 2 месяца = 60 дней) развернулись на каждый день календаря.
Верни только один корректный JSON-объект без Markdown, пояснений и текста до или после JSON:
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

      const initialResponse = await callGigaChatWithFallback(
        token,
        [{ role: "user", content: prompt }],
        preferredModel,
        0.1
      );
      let usedModel = initialResponse.usedModel;
      let reminders: ReminderItem[];
      try {
        reminders = expandAndValidateSchedule(initialResponse.reply, baseDate);
      } catch (validationError) {
        const validationMessage =
          validationError instanceof Error ? validationError.message : String(validationError);
        const repairedResponse = await callGigaChatWithFallback(
          token,
          [
            { role: "user", content: prompt },
            { role: "assistant", content: initialResponse.reply },
            {
              role: "user",
              content: `Предыдущий ответ не удалось разобрать или проверить: ${validationMessage}. Исправь ответ и верни только один корректный JSON-объект с непустым массивом "rules" по указанной схеме. Не добавляй Markdown или пояснения.`,
            },
          ],
          initialResponse.usedModel,
          0.1
        );
        reminders = expandAndValidateSchedule(repairedResponse.reply, baseDate);
        usedModel = repairedResponse.usedModel;
      }
      res.json({ reminders, usedModel });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Ошибка генерации расписания: ${message}` });
    }
  });

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
          "Демо-режим: добавьте GIGACHAT_CREDENTIALS или GIGACHAT_CLIENT_ID и GIGACHAT_CLIENT_SECRET в файл .env на сервере, чтобы включить ответы GigaChat.",
      });
      return;
    }

    try {
      const token = await getGigaChatToken(credentials, scope);
      const contextNote = recommendationsText
        ? `\nПрикреплённые рекомендации пациента:\n${recommendationsText}`
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
