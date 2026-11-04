import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Architecture invariant 2: only the worker talks to OANDA. The app and
  // shared libs must never import worker code.
  {
    files: ["app/**", "components/**", "lib/**", "proxy.ts", "instrumentation.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/worker/**", "@/worker/**"], message: "app/ and lib/ must not import worker/ (architecture invariant 2)." }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Static design reference and context docs (read-only, never imported)
    "doc/**",
    // Generated Prisma client
    "lib/db/generated/**",
  ]),
]);

export default eslintConfig;
