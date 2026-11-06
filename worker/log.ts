// Structured JSON-line logging for the worker. Callers must never pass
// secrets (tokens, headers, connection strings).
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = (fields: LogFields) => void;

export const jsonLogger: Logger = (fields) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
};

export const silentLogger: Logger = () => {};

/**
 * Readable message for anything thrown, including WebSocket ErrorEvents
 * from the Neon driver (which are not Error instances).
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const e = error as { message?: unknown; error?: unknown; type?: unknown };
    if (typeof e.message === "string" && e.message) return e.message;
    if (e.error instanceof Error) return e.error.message;
    if (typeof e.type === "string") return `${e.type} event (network unavailable?)`;
  }
  return String(error);
}
