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
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body && typeof init.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });
  const body = await response.json();
  if (response.status === 401 && path !== "/auth/login")
    window.dispatchEvent(new Event("recovery-session-expired"));
  if (!response.ok)
    throw new Error(body.error || `Ошибка запроса (${response.status}).`);
  return body as T;
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
