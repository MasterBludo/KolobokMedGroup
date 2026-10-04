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

function resolveGigaChatCredentials(): string | null {
  const credentials = process.env.GIGACHAT_CREDENTIALS?.trim();
  if (credentials && credentials !== "YOUR_GIGACHAT_AUTH_KEY") {
    return credentials;
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

async function callGigaChat(
  token: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "GigaChat",
      messages,
      temperature: 0.7,
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Возвращает файлы первого коммита для GitHub (README.md, app.py, requirements.txt, .env.example)
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

  // Простой эндпоинт диалога с GigaChat
  app.post("/api/chat", async (req, res) => {
    const { messages } = req.body as {
      messages?: Array<{ role: string; content: string }>;
    };

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Некорректный формат сообщений" });
      return;
    }

    const credentials = resolveGigaChatCredentials();
    const scope = process.env.GIGACHAT_SCOPE || "GIGACHAT_API_PERS";

    if (!credentials) {
      res.json({
        reply:
          "Демо-режим: укажите GIGACHAT_CREDENTIALS или пару GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET в .env.",
      });
      return;
    }

    try {
      const token = await getGigaChatToken(credentials, scope);
      const reply = await callGigaChat(token, messages);
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
