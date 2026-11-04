// Structured JSON-line logging for the worker. Callers must never pass
// secrets (tokens, headers, connection strings).
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = (fields: LogFields) => void;

export const jsonLogger: Logger = (fields) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
};

export const silentLogger: Logger = () => {};
