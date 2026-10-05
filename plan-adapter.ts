import { ApiError, sha256 } from "./auth";
export interface Reminder {
  date: string;
  time: string | null;
  title: string;
  description: string;
}
export interface Instruction {
  key: string;
  title: string;
  instruction: string;
  startsOn: string;
  endsOn: string;
  times: string[] | null;
  events: Reminder[];
}
export const normalize = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
export function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function prescriptionKey(
  item: Pick<
    Instruction,
    "title" | "instruction" | "startsOn" | "endsOn" | "times"
  >,
) {
  return sha256(
    JSON.stringify({
      v: 1,
      kind: "other",
      title: normalize(item.title),
      instruction: normalize(item.instruction),
      medicationName: null,
      dose: null,
      frequency: null,
      startsOn: item.startsOn,
      endsOn: item.endsOn,
      duration: null,
      interval: null,
      times: item.times,
      asNeeded: false,
    }),
  );
}
export function adaptReminders(input: unknown): Instruction[] {
  if (!Array.isArray(input) || !input.length || input.length > 20000)
    throw new ApiError(
      422,
      "Расписание должно содержать от 1 до 20000 событий.",
    );
  const groups = new Map<string, Reminder[]>();
  for (const raw of input) {
    if (
      !raw ||
      !validDate(raw.date) ||
      typeof raw.title !== "string" ||
      !raw.title.trim() ||
      typeof raw.description !== "string" ||
      !raw.description.trim()
    )
      throw new ApiError(422, "Неверное событие расписания.");
    const time = raw.time == null || raw.time === "" ? null : raw.time;
    if (
      time !== null &&
      (typeof time !== "string" ||
        !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(time))
    )
      throw new ApiError(422, "Неверное время события.");
    const reminder: Reminder = {
      date: raw.date,
      time: time?.slice(0, 5) ?? null,
      title: raw.title.trim(),
      description: raw.description.trim(),
    };
    const identity = JSON.stringify([
      normalize(reminder.title),
      normalize(reminder.description),
    ]);
    const list = groups.get(identity) || [];
    // Unknown times may represent separate occurrences: retain their multiplicity.
    if (
      reminder.time === null ||
      !list.some(
        (event) => event.date === reminder.date && event.time === reminder.time,
      )
    )
      list.push(reminder);
    groups.set(identity, list);
  }
  return [...groups.values()].map((events) => {
    events.sort((a, b) =>
      `${a.date}|${a.time ?? "99:99"}`.localeCompare(
        `${b.date}|${b.time ?? "99:99"}`,
      ),
    );
    const times = [
      ...new Set(events.flatMap((event) => (event.time ? [event.time] : []))),
    ].sort();
    const item = {
      title: events[0].title,
      instruction: events[0].description,
      startsOn: events[0].date,
      endsOn: events[events.length - 1].date,
      times: times.length ? times : null,
      events,
    };
    return { ...item, key: prescriptionKey(item) };
  });
}
export function localToday(tz: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function possibleConflict(
  a: { title: string; instruction: string },
  b: { title: string; instruction: string },
) {
  if (
    normalize(a.instruction) === normalize(b.instruction) &&
    normalize(a.title) === normalize(b.title)
  )
    return false;
  const words = (text: string): string[] =>
    normalize(text).match(/[\p{L}]{3,}/gu) || [];
  const aw = words(a.title),
    bw = words(b.title);
  return (
    normalize(a.title) === normalize(b.title) ||
    aw.some((word) => bw.includes(word))
  );
}
