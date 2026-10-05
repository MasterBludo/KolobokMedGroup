import { randomBytes, createHash } from "node:crypto";
import * as argon2 from "argon2";
import { Router, Request, Response, NextFunction } from "express";
import { database, transaction } from "./db";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function timezone(value: unknown) {
  if (typeof value !== "string" || (!value.includes("/") && value !== "UTC"))
    throw new ApiError(400, "Укажите часовой пояс IANA.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    throw new ApiError(400, "Неверный часовой пояс.");
  }
  return value;
}
export function contact(emailValue?: unknown, phoneValue?: unknown) {
  const email =
    typeof emailValue === "string" && emailValue.trim()
      ? emailValue.trim().toLowerCase()
      : null;
  const phone =
    typeof phoneValue === "string" && phoneValue.trim()
      ? phoneValue.replace(/[\s().-]/g, "")
      : null;
  if (!email && !phone)
    throw new ApiError(
      400,
      "Укажите email или телефон с международным кодом (+...).",
    );
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)))
    throw new ApiError(400, "Неверный email.");
  if (phone && !/^\+[1-9][0-9]{6,14}$/.test(phone))
    throw new ApiError(
      400,
      "Телефон должен содержать явный международный код (+...).",
    );
  return { email, phone };
}
export function username(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100)
    throw new ApiError(400, "Имя должно содержать от 1 до 100 символов.");
  return value.trim();
}
function password(value: unknown) {
  if (typeof value !== "string" || value.length < 8 || value.length > 256)
    throw new ApiError(400, "Пароль должен содержать от 8 до 256 символов.");
  return value;
}
const publicColumns = "id, username, email, phone, timezone";
const cookieName = "recovery_session";
function token(req: Request) {
  return req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}
function cookieOptions() {
  const secure = process.env.COOKIE_SECURE === "true";
  if (process.env.NODE_ENV === "production" && !secure)
    throw new Error("Production requires COOKIE_SECURE=true and HTTPS.");
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/" };
}
export function validateAuthConfig() {
  cookieOptions();
  const origins = allowedOrigins();
  if (
    !origins.length ||
    origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return (
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.origin !== origin
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new Error(
      "APP_ORIGINS must contain comma-separated HTTP/HTTPS origins.",
    );
  }
}
function allowedOrigins() {
  return (
    process.env.APP_ORIGINS ||
    (process.env.NODE_ENV !== "production"
      ? "http://localhost:5173,http://localhost:3000"
      : "")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
export function protectOrigins(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !allowedOrigins().includes(req.headers.origin || "")
  ) {
    next(new ApiError(403, "Недопустимый источник запроса."));
    return;
  }
  next();
}
export async function findPatient(req: Request) {
  const raw = token(req);
  if (!raw || !/^[0-9a-f]{64}$/.test(raw)) return null;
  const { rows } = await database().query(
    `SELECT p.${publicColumns.split(", ").join(", p.")} FROM sessions s JOIN patients p ON p.id=s.patient_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP`,
    [sha256(raw)],
  );
  return rows[0] || null;
}
export function authenticate(req: Request, res: Response, next: NextFunction) {
  findPatient(req)
    .then((patient) => {
      if (!patient) throw new ApiError(401, "Войдите в аккаунт.");
      res.locals.patient = patient;
      next();
    })
    .catch(next);
}
async function issueSession(
  patientId: string,
  res: Response,
  client: { query: Function } = database(),
) {
  const raw = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 7 * 86400_000);
  await client.query(
    "INSERT INTO sessions(patient_id, token_hash, expires_at) VALUES($1,$2,$3)",
    [patientId, sha256(raw), expires],
  );
  return () => res.cookie(cookieName, raw, { ...cookieOptions(), expires });
}
export function authRouter() {
  const router = Router();
  router.post(
    "/register",
    wrap(async (req, res) => {
      const name = username(req.body.username);
      const tz = timezone(req.body.timezone);
      const { email, phone } = contact(req.body.email, req.body.phone);
      const hash = await argon2.hash(password(req.body.password), {
        type: argon2.argon2id,
      });
      try {
        const result = await transaction(async (client) => {
          const { rows } = await client.query(
            `INSERT INTO patients(username,email,phone,password_hash,timezone) VALUES($1,$2,$3,$4,$5) RETURNING ${publicColumns}`,
            [name, email, phone, hash, tz],
          );
          const setCookie = await issueSession(rows[0].id, res, client);
          return { patient: rows[0], setCookie };
        });
        result.setCookie();
        res.status(201).json({ patient: result.patient });
      } catch (error) {
        if ((error as { code?: string }).code === "23505")
          throw new ApiError(
            409,
            "Этот email или телефон уже зарегистрирован.",
          );
        throw error;
      }
    }),
  );
  router.post(
    "/login",
    wrap(async (req, res) => {
      const input = String(req.body.contact || "").trim();
      const { email, phone } = contact(
        input.includes("@") ? input : null,
        input.includes("@") ? null : input,
      );
      const pass = password(req.body.password);
      const { rows } = await database().query(
        "SELECT * FROM patients WHERE email=$1 OR phone=$2",
        [email, phone],
      );
      const patient = rows[0];
      // A dummy hash avoids skipping expensive verification for an unknown contact.
      const hash =
        patient?.password_hash ||
        (await argon2.hash(randomBytes(32), { type: argon2.argon2id }));
      if (!(await argon2.verify(hash, pass)) || !patient)
        throw new ApiError(401, "Неверный контакт или пароль.");
      const setCookie = await issueSession(patient.id, res);
      setCookie();
      const safe = Object.fromEntries(
        publicColumns.split(", ").map((key) => [key, patient[key]]),
      );
      res.json({ patient: safe });
    }),
  );
  router.get(
    "/me",
    wrap(async (req, res) => {
      res.json({ patient: await findPatient(req) });
    }),
  );
  router.post(
    "/logout",
    wrap(async (req, res) => {
      const raw = token(req);
      if (raw)
        await database().query(
          "UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=$1 AND revoked_at IS NULL",
          [sha256(raw)],
        );
      res.clearCookie(cookieName, cookieOptions());
      res.json({ ok: true });
    }),
  );
  return router;
}
