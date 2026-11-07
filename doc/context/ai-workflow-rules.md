# AI Workflow Rules

## Approach

Build DG Signals incrementally using a spec-driven workflow. The files in
`doc/context/` define what to build (`project-overview.md`), how it is
structured (`architecture.md`), how code is written (`code-standards.md`),
how it looks (`ui-context.md`) and where we are (`progress-tracker.md`).
Always implement against these specs. Do not infer or invent behaviour,
and above all do not invent trading rules: the strategy is DG's, and
anything he has not confirmed is an open question.

## Scoping Rules

- Work on one feature unit from `progress-tracker.md` at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single implementation
  step.

## When to Split Work

Split an implementation step if it combines:

- Dashboard UI changes and worker changes
- Strategy rule changes and notification or database changes
- Behaviour not clearly defined in the context files

If a change cannot be verified end to end quickly, the scope is too broad.
Split it.

## Handling Missing Requirements

- Do not invent product behaviour not defined in the context files.
- If a requirement is ambiguous, resolve it in the relevant context file
  before implementing.
- If a requirement is missing, add it as an open question in
  `progress-tracker.md` before continuing.
- For an open trading parameter (stop buffer, expiry, tolerance), use the
  default listed in `progress-tracker.md`, keep it as a named constant or
  setting, and do not hardcode it inline.

## Data Access Rule

- Pages (`app/`) and components (`components/`) get data only through
  `lib/data/`: server functions in `lib/data/index.ts` (server-only),
  server actions in `lib/data/*actions.ts`, view-model types in
  `lib/data/types.ts` and display helpers in `lib/data/format.ts`.
- They never import Prisma (`lib/db/`, `@prisma/*`), the notification
  senders (`lib/notify/`), market internals (`lib/market/`) or `worker/`.
  ESLint enforces this (`eslint.config.mjs`).
- `lib/data/` returns plain, serialisable view models (ISO strings for
  times), never Prisma objects.
- Every page, server action and route handler that touches data calls
  `requireAllowedUser()` first.

## Protected Files

Do not modify the following unless explicitly instructed:

- `components/ui/*` — generated shadcn components (theme via tokens instead)
- `doc/design/*` — the static design reference; read it, never edit or import it
- `prisma/migrations/*` — existing migrations; create new ones instead
- `.env*` files — never print or commit secrets
- Any third-party library internals

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes:

- System architecture or boundaries
- Storage model decisions
- Code conventions or standards
- Feature scope
- Strategy rules or their default values

## Before Moving to the Next Unit

1. The current unit works end to end within its defined scope.
2. No invariant defined in `architecture.md` was violated.
3. Strategy and risk changes have passing Vitest tests.
4. `progress-tracker.md` reflects the completed work.
5. `npm run build` passes.
