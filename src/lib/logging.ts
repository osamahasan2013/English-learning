import "server-only";

// Structured JSON logs (one object per line) for server code: auth failures, database
// and sync failures, assessment and import problems. Log ids and error codes, never
// children's names, parents' emails or free-text answers — that is sensitive data and
// logs are widely readable. Swapping in an APM later means changing `write` only.

type LogLevel = "info" | "warn" | "error";
type LogValue = string | number | boolean | null | undefined;
type LogFields = Record<string, LogValue>;

function write(level: LogLevel, event: string, fields?: LogFields) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error)
    return String((error as { message: unknown }).message);
  return String(error);
}
