// Single-worker guard: a Postgres session advisory lock on a dedicated
// DIRECT (non-pooled) connection — the pooled URL is transaction-mode and
// can't hold session locks.
//
// Neon scales an idle database to zero after ~5 minutes and closes every
// connection, open or not ("terminating connection due to administrator
// command"; seen 2026-11-05). So the lock can't stay held through the
// 15-minute gap between cycles. Instead it is (re)taken before every cycle:
// - startup: refused if another worker holds it right now
// - connection closed while idle: logged, not fatal
// - before each cycle: reconnect and take it again; if another worker has
//   it, this worker stops
// Two workers can therefore never run a cycle at the same time. The holding
// connection costs nothing extra: Neon still suspends when idle.
import { Client, neonConfig } from "@neondatabase/serverless";
import type { Logger } from "./log";

// Node 22+ has a global WebSocket.
neonConfig.webSocketConstructor = WebSocket;

/** Arbitrary app-wide key ("DONQ"). */
export const WORKER_LOCK_KEY = 0x444f4e51;

export class WorkerLock {
  private client: Client | null = null;
  private closing = false;

  constructor(
    private readonly directUrl: string,
    private readonly logger: Logger,
  ) {}

  /** True while the lock connection is open (the lock is held). */
  get held(): boolean {
    return this.client !== null;
  }

  /** Takes the lock if free. Returns false if another worker holds it. */
  async acquire(): Promise<boolean> {
    if (this.client) return true;
    const client = new Client({ connectionString: this.directUrl });
    await client.connect();
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [WORKER_LOCK_KEY],
    );
    if (!result.rows[0]?.locked) {
      await client.end().catch(() => {});
      return false;
    }
    const onClosed = (reason: string) => {
      if (this.client !== client) return;
      this.client = null;
      if (!this.closing) {
        this.logger({
          component: "lock",
          outcome: "connection_closed",
          message: `${reason}; the lock is re-taken before the next cycle`,
        });
      }
    };
    client.on("error", (error: Error) => onClosed(error.message));
    client.on("end", () => onClosed("lock connection closed"));
    this.client = client;
    return true;
  }

  /** Before each cycle: make sure the lock is held. False = another worker has it. */
  async ensure(): Promise<boolean> {
    if (this.client) {
      try {
        await this.client.query("select 1");
        return true;
      } catch {
        this.client = null; // dropped; fall through and re-take
      }
    }
    return this.acquire();
  }

  async release(): Promise<void> {
    this.closing = true;
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.query("select pg_advisory_unlock($1)", [WORKER_LOCK_KEY]);
    } catch {
      // Connection already gone: the lock went with it.
    } finally {
      await client.end().catch(() => {});
    }
  }
}
