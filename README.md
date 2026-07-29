# Fitness Tracker

A personal strength-first training app: it generates programs, logs what you
actually lifted, and answers questions about your own training data.

Single-user by design. Deployed to Vercel behind a password gate.

## Design decision: engine first, Claude second

Workouts are produced by a **deterministic programming engine**, not by asking a
language model to invent a session. Claude is the coach layer on top.

This split is deliberate:

- **Progressive overload needs state.** "You hit 3×8 at 80 kg at RPE 8, so this
  week is 3×9" is arithmetic over logged history. A model asked to improvise a
  workout has no reliable memory of your accumulated volume.
- **Equipment constraints must be hard.** A database filter provably cannot put a
  cable machine in a hotel room. A model occasionally will.
- **Cost and latency.** Generating a four-week block deterministically is instant
  and free; regenerating it repeatedly through an API is neither.
- **Reproducibility.** Same inputs, same program.

Claude is then used for what it is genuinely better at: interpreting vague goals,
explaining why an exercise is prescribed, and reviewing logged data — grounded in
real rows via tool use rather than guesswork.

## Stack

| Concern   | Choice                                          |
| --------- | ----------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack) + TypeScript |
| Styling   | Tailwind CSS 4 (CSS-first config)               |
| Database  | Neon Postgres                                   |
| ORM       | Drizzle                                         |
| Hosting   | Vercel                                          |
| Coach     | Anthropic API (Claude), server-side only        |

### Notes for anyone (or any agent) working on this

- This is **Next.js 16**, which renamed `middleware` to **`proxy`** — see
  [`src/proxy.ts`](src/proxy.ts). The exported function must be named `proxy`, and
  it always runs on the Node.js runtime.
- `cookies()`, `headers()`, `params` and `searchParams` are **async only**.
- Bundled framework docs live in `node_modules/next/dist/docs/` and are the
  authority over anything remembered about older versions.

## Local setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

### Environment variables

| Variable               | Required     | Purpose                                        |
| ---------------------- | ------------ | ---------------------------------------------- |
| `FITNESS_DATABASE_URL` | yes\*        | Neon **pooled** connection string              |
| `DATABASE_URL`         | yes\*        | Fallback if the above is unset                 |
| `APP_PASSWORD`         | yes          | The password used to sign in                   |
| `SESSION_SECRET`       | yes          | Signs the session cookie; 32+ chars            |
| `ANTHROPIC_API_KEY`    | Phase 4 only | Coach access; billed separately from Claude.ai |
| `FEATURE_COACH`        | no           | `"true"` turns the coach on                    |

\* Set one of the two. `FITNESS_DATABASE_URL` wins.

**Why two names.** Vercel's Neon integration installs `DATABASE_URL` as a
*managed* variable: it cannot be edited in the dashboard, and it points at the
Neon project's default database (`neondb`). This app uses its own `fitness`
database, so `FITNESS_DATABASE_URL` provides a way to redirect it without
disconnecting the integration. The connection string must end in `/fitness`.

The setup status page names the database it actually reached and counts the
exercise rows, rather than running `select 1` — which would report success
against any database, including one where the schema does not exist.

Generate a session secret with:

```bash
openssl rand -base64 32
```

The app degrades gracefully: with no `DATABASE_URL` it still boots and reports
setup state, and with no `ANTHROPIC_API_KEY` everything except the coach works.

**Never commit real secrets.** `.env.local` is gitignored; `.env.example` holds
placeholders only. If a key is ever pasted somewhere it shouldn't be — a chat
window, a screenshot, a commit — rotate it rather than hoping.

### Database

```bash
npm run db:generate   # create SQL migrations from the schema
npm run db:migrate    # apply them
npm run db:studio     # browse the data
```

## Why there is a password on a single-user app

The deployment has a public URL. Without a gate, anyone who finds it can read the
training log and, once the coach is live, spend the owner's Anthropic credit.

The session cookie is an HMAC-signed expiry stamp — no session table needed, and
unforgeable without `SESSION_SECRET`. Rotating that secret signs out everywhere.

Note that `proxy.ts` is **not** the only line of defence. Server Functions are
POST requests to the route where they are used, so a matcher change can silently
drop proxy coverage. Every server action and route handler that touches data calls
`requireAuth()` from [`src/lib/auth.ts`](src/lib/auth.ts) directly.

## Data model

Defined in [`src/lib/db/schema.ts`](src/lib/db/schema.ts). Two conventions worth
knowing before extending it:

- **UUID primary keys generated client-side.** Offline logging must create rows
  with no server contact, so IDs cannot come from a sequence. Sync is then an
  idempotent upsert on the primary key.
- **All weights stored in kilograms**, converted only at the display boundary.
  Mixed units in storage is the classic way to corrupt a training log.

The domain vocabulary — movement patterns, muscle groups, equipment, load types —
lives in [`src/lib/domain/types.ts`](src/lib/domain/types.ts) and deliberately has
no database imports, so the engine can be tested in isolation.

## The coach

A Claude conversation with read access to the training log, at `/coach`. It is
off unless both `FEATURE_COACH="true"` and `ANTHROPIC_API_KEY` are set; the page
says which one is missing.

**Grounded, not generic.** Eight tools — recent sessions, one exercise's history,
estimated maxima, volume per muscle against the MEV/MAV/MRV landmarks, training
cadence, the programme schedule, the next session, and the exercise library. The
system prompt tells it to look things up before making claims and to say when the
data is too thin, which for a log a few weeks old is often the honest answer.

**Read-only on purpose.** The coach can recommend a change and explain why; it
cannot make one. The engine decides what a session looks like, and a coach that
could silently rewrite the programme would turn every conversation into something
you have to supervise. Changes stay a deliberate act on the Program screen.

**Consistency with the app is a hard requirement.** The coach counts a set the
same way the generator budgets one (primary 1, secondary 0.5) and estimates a max
with the same engine function the strength page uses. Two components disagreeing
about the owner's bench max is worse than either being slightly wrong.

`npm run coach` prints what every tool returns against the live database, which
is how the grounding gets checked without spending a model call.

### Cost and safety

The key is server-side only and never reaches the browser. The system prompt is
split into a fixed brief and a per-lifter snapshot, each with a cache breakpoint,
so repeat questions re-read the expensive prefix at a tenth of the price. A
per-process rate limit caps runaway loops — a guard against a retry storm, not a
quota, since there is exactly one user behind a password.

Training only: no nutrition, and anything that sounds medical gets pointed at a
clinician rather than worked around.

## Roadmap

| Phase | Scope                                                       | Status |
| ----- | ----------------------------------------------------------- | ------ |
| 0     | Scaffold, database wiring, session gate, deploy             | done   |
| 1     | Exercise library + offline set logging (PWA)                | done   |
| 2     | Generation engine: split → time budget → volume → selection | done   |
| 3     | Progression, autoregulation, deloads, travel mode           | done   |
| 4     | Claude coach with data-grounded tools                       | done   |
| 5     | Cardio and conditioning + analytics                        | next   |

Phase 1 landed before Phase 2 on purpose: logging is useful on its own, and the
engine needs real logged history before it has anything to progress from.

### Known open question

Cardio integration is manual-entry-first. The schema in `cardio_activities`
already carries heart-rate, GPS and interval fields so a wearable import can slot
in without a migration — but the source is undecided. Apple Health has no web API,
and Garmin's requires partner approval, so Strava is usually the only clean path
for a web app.
