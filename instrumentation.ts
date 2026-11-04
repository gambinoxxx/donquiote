// Runs once when the server starts, before it handles any request.
// Fails fast with a clear message if auth env vars are missing or invalid.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("./lib/env");
    getServerEnv();
  }
}
