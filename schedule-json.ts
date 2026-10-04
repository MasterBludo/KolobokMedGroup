export interface SchedulePayload {
  rules?: unknown[];
  reminders?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeTrailingCommas(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === ",") {
      let nextIndex = index + 1;
      while (/\s/.test(json[nextIndex] || "")) nextIndex += 1;
      if (json[nextIndex] !== "}" && json[nextIndex] !== "]") {
        result += character;
      }
    } else {
      result += character;
    }
  }

  return result;
}

export function parseScheduleJson(rawText: string): SchedulePayload {
  let lastParseError: unknown;

  for (let start = 0; start < rawText.length; start += 1) {
    if (rawText[start] !== "{") continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < rawText.length; index += 1) {
      const character = rawText[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = removeTrailingCommas(rawText.slice(start, index + 1));
          try {
            const parsed: unknown = JSON.parse(candidate);
            if (
              isRecord(parsed) &&
              ((Array.isArray(parsed.rules) && parsed.rules.length > 0) ||
                (Array.isArray(parsed.reminders) && parsed.reminders.length > 0))
            ) {
              return {
                rules: Array.isArray(parsed.rules) ? parsed.rules : undefined,
                reminders: Array.isArray(parsed.reminders) ? parsed.reminders : undefined,
              };
            }
          } catch (error) {
            lastParseError = error;
          }
          break;
        }
      }
    }
  }

  if (lastParseError instanceof Error) {
    throw new Error(`В ответе модели не найден корректный JSON расписания: ${lastParseError.message}`);
  }
  throw new Error("В ответе модели не найден JSON с правилами или напоминаниями");
}
