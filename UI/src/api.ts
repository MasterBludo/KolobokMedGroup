export interface Patient {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  timezone: string;
}
export interface PlanEvent {
  id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  title: string;
  description: string;
  status: string;
  completed_at: string | null;
}
export interface PlanSnapshot {
  plan: {
    id: string;
    version: number;
    patient_id: string;
    recovery_start_date: string | null;
    procedure_name: string | null;
    confirmed_instructions: string | null;
  } | null;
  prescriptions: {
    id: string;
    title: string;
    instruction: string;
    status: string;
  }[];
  events: PlanEvent[];
}
export interface PlanPreview {
  draftId: string;
  version: number;
  startDate: string;
  usedModel: string;
  changes: {
    key: string;
    title: string;
    instruction: string;
    action: string;
    events: {
      date: string;
      time: string | null;
      title: string;
      description: string;
    }[];
    conflicts: {
      id: string;
      title: string;
      instruction: string;
      startsOn: string;
      endsOn: string;
    }[];
  }[];
}
export async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`/api${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "same-origin",
      headers: {
        ...(init.body && typeof init.body === "string"
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event("recovery-session-expired"));
    const body = await response.json().catch(() => {
      throw new Error('Сервер вернул некорректный ответ. Повторите попытку.');
    });
    if (!response.ok)
      throw new Error(body.error || `Ошибка запроса (${response.status}).`);
    return body as T;
  } catch (error) {
    if (timedOut)
      throw new Error('Сервер не ответил вовремя. Повторите попытку.');
    if (error instanceof TypeError)
      throw new Error('Нет соединения с сервером. Повторите попытку.');
    throw error;
  } finally {
    window.clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}
export function patientToday(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}
