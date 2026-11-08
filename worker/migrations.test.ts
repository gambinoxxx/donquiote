import { describe, expect, it } from "vitest";
import { localMigrations, migrationProblem, migrationStatus } from "./migrations";

const ok = (name: string) => ({ name, finished: true, rolledBack: false });

describe("worker migration check", () => {
  it("current database: no problem", () => {
    const s = migrationStatus(["a", "b"], [ok("a"), ok("b")]);
    expect(s).toEqual({ pending: [], failed: [], unknown: [] });
    expect(migrationProblem(s)).toBeNull();
  });
  it("behind: names the pending migrations and the fix", () => {
    const p = migrationProblem(migrationStatus(["a", "b", "c"], [ok("a")]));
    expect(p).toContain("2 migration(s) not applied (b, c)");
    expect(p).toContain("npm run db:deploy");
  });
  it("empty database: everything pending", () => {
    expect(migrationStatus(["a", "b"], []).pending).toEqual(["a", "b"]);
  });
  it("a failed migration is reported first; rolled-back rows are ignored", () => {
    const s = migrationStatus(["a", "b"], [ok("a"), { name: "b", finished: false, rolledBack: false }]);
    expect(migrationProblem(s)).toContain("failed earlier (b)");
    const rolled = migrationStatus(["a", "b"], [ok("a"), { name: "b", finished: false, rolledBack: true }, ok("b")]);
    expect(migrationProblem(rolled)).toBeNull();
  });
  it("database ahead of an older worker image is not fatal", () => {
    const s = migrationStatus(["a"], [ok("a"), ok("z")]);
    expect(s.unknown).toEqual(["z"]);
    expect(migrationProblem(s)).toBeNull();
  });
  it("reads the real prisma/migrations folders", async () => {
    const names = await localMigrations();
    expect(names[0]).toBe("20261104151604_init");
    expect(names).toContain("20261108120000_news");
  });
});
