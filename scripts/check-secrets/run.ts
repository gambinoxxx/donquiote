// npm run check:secrets — after `npm run build`. Fails (exit 1) if a
// server-only variable name, or the value of one set in this shell / .env,
// appears in any browser file (.next/static, public/). Prints names and
// files only, never values.
import "dotenv/config";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { scanFile, secretValues, type Finding, type ScanResult } from "./scan";

const ROOT = process.cwd();
const DIRS = [".next/static", "public"];
const TEXT = /\.(js|mjs|css|html|json|map|txt|webmanifest|svg)$/;

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else if (TEXT.test(entry.name)) yield p;
  }
}

async function main(): Promise<number> {
  try {
    await stat(join(ROOT, ".next/static"));
  } catch {
    console.error("check:secrets: no .next/static — run `npm run build` first.");
    return 1;
  }
  const values = secretValues(process.env);
  const findings: Finding[] = [];
  const ignored: ScanResult["ignored"] = [];
  let scanned = 0;
  for (const dir of DIRS) {
    for await (const file of files(join(ROOT, dir))) {
      scanned++;
      const r = scanFile(relative(ROOT, file), await readFile(file, "utf8"), values);
      findings.push(...r.findings);
      ignored.push(...r.ignored);
    }
  }
  for (const i of ignored) console.log(`check:secrets: ignored in ${i.file}: ${i.reason}`);
  if (findings.length === 0) {
    console.log(`check:secrets: OK — ${scanned} browser files, no server-only names; ${values.length} secret values checked.`);
    return 0;
  }
  console.error("check:secrets: FAILED — server-only variables in browser files:");
  for (const f of findings) console.error(`  - ${f.kind === "value" ? `value of ${f.name}` : f.name} in ${f.file}`);
  return 1;
}

main().then((code) => {
  process.exitCode = code;
});
