# 🦇 The Riddler's Game — a co-op escape room on [Temporal](https://temporal.io)

[![CI](https://github.com/TheRealChrisThomas/riddlers-game/actions/workflows/ci.yml/badge.svg)](https://github.com/TheRealChrisThomas/riddlers-game/actions/workflows/ci.yml)

The Bat-Family is trapped in three of the Riddler's chambers. Clear all three together
before the clock runs out. It's a game — but every mechanic is a Temporal primitive, so
it doubles as a hands-on tour of durable execution.

The headline moment: **kill the worker mid-game and the whole case survives** — timer,
chamber progress, and all — because Temporal replays it from event history.

---

## How the escape maps onto Temporal

```
batcomputerWorkflow  (grandparent, workflowId = case code)   ← roster, score, case files
│   waits durably for a Bat-Signal — a signal naming a villain — then launches
└─► escapeWorkflow  (parent, CODE-riddler-r1)                ← shared deadline, timed taunts
    │   spawns one child workflow per chamber, in order
    ├─► child  CODE#r1c1  The Riddle Lock    → Signals in / Query out (the workflow holds the code)
    ├─► child  CODE#r1c2  The Deathtrap      → Saga + compensation (a miss re-arms your last wire)
    └─► child  CODE#r1c3  The Final Escape   → Activity retries + backoff, then a co-op hold
            ESCAPE = all three children cleared before the shared deadline
            outcome banked into the score, then the hub Continue-As-News
            (same case code so the invite link never changes, fresh history, round r2…)
```

| Chamber | Temporal primitive | The puzzle |
| ------- | ------------------ | ---------- |
| **The Riddle Lock** | Signals + Query; the workflow is the authority on a secret | Crack a 4-digit code (Mastermind-style ●/○ feedback). Guesses are signals; the board is a query; the code never leaves the worker. |
| **The Deathtrap** | Saga / compensation + activities | Cut four wires in order via a timing minigame — and only the right hero may touch each wire. A missed cut runs a compensation activity that re-arms the last wire you cut (one step back). |
| **The Final Escape** | Activity retries/backoff + timer + co-op | Override the vault — a deliberately flaky activity Temporal auto-retries with backoff — then every hero holds the exit at the same moment. |

Across the arc this touches **child workflows, signals, queries, durable timers,
sagas/compensation, activity retries, and continue-as-new.** The Riddler's timed taunts are
driven by a workflow timer racing each chamber's completion — no cron, no scheduler.

---

## The durability demo

1. Start a case and get into any chamber.
2. **Kill the worker** (`Ctrl+C` its terminal).
3. The board freezes and a banner appears — but the countdown keeps running in the browser.
4. **Restart the worker** (`npm run worker`). The case resumes at the exact right time with
   all chamber progress intact.

The shared deadline lives on the *parent* and spans all three chambers, so this works even
across the parent/child boundary. Watch it happen in the Temporal Web UI too (below).

---

## Run it

Requires Node 20+ and Docker.

```bash
npm install
npm --prefix web install

# terminal 1 — Temporal dev server (Web UI: http://localhost:8233)
npm run temporal

# terminal 2 — the worker (Ctrl+C this one for the durability demo)
npm run worker

# terminal 3 — API + web
npm run api
npm run web        # http://localhost:5173
```

Or `npm run dev` runs worker + API + web together (Temporal stays separate via `npm run temporal`).

**Play co-op:** create a case, hit *copy invite link*, send it to friends. Everyone picks a
Bat-Family role — roles matter (the Deathtrap gates each wire to a specific hero). The
puzzles scale from 1 to 4 players. State is shared through the workflow itself: player
actions are signals, and every client polls the same case — no database, no locks.

**Dev tip:** run the API with `npm run api:reveal` (sets `REVEAL_CODE=1`) to expose the
riddle answer + an autofill button, so you can skip the Mastermind grind while testing.

---

## Tests

```bash
npm test          # everything, ~15s
npm run test:watch
npm run typecheck # server + web
```

> **Changing dependencies?** Use `npm run lock`, not a bare `npm install`. rollup,
> esbuild and `@swc/core` ship their native code as per-platform optional deps, and npm
> only records the platform it is run on ([npm/cli#4828](https://github.com/npm/cli/issues/4828))
> — so a lockfile written on a Mac makes `npm ci` on Linux CI install a rollup with no
> binary. `npm run lock` regenerates both lockfiles with every platform included;
> `npm run check:lock` verifies it, and CI runs that check before installing anything.

No Docker, no running Temporal, nothing to start first — the workflow tests boot Temporal's
**time-skipping test server** themselves (downloaded and cached on first run). When every
workflow is parked on a timer the server jumps the clock instead of waiting, so a 12-minute
case deadline and the vault's retry backoff both resolve in milliseconds. The whole suite,
including a full three-chamber win, runs in about fifteen seconds.

What's covered:

| Test | What would break without it |
| ---- | --------------------------- |
| Riddle lock: solve, near-miss scoring, deadline | Signal/query round-trip; ●/○ feedback; the chamber giving up on time |
| Deathtrap: in-order disarm, out-of-order cut | Saga compensation rewinding **one** wire — and the room still being solvable after |
| Vault: override + hold | Temporal retrying the flaky activity (asserts it took 4 attempts) |
| Bat-computer: seed args, sealed case files | Continue-As-New restoring team/score/record; locked villains staying locked |
| Bat-computer: a won case, end to end | Score banking and Continue-As-New across the whole grandparent → parent → child chain |

> **Apple Silicon:** Temporal's time-skipping test server is an x86 binary and needs Rosetta 2
> (`softwareupdate --install-rosetta`). CI runs on x86 Linux, so this only affects local runs.

Two GitHub Actions workflows, both annotated line by line if you're learning Actions:
`ci.yml` (typecheck, build, test on push + PR) and `pr-checks.yml` (a Node matrix, path-based
job skipping, job outputs, and a run summary).

---

## Watch the workflows

Two ways to see the Temporal execution as you play:

- **In-app** — flip the **WORKFLOW** chip in the console bar. A side panel streams a digested
  live trace of the parent + active child: signals landing, durable timers, child chambers
  spawning, the vault activity **retrying with backoff**, and continue-as-new. (History comes
  from `fetchHistory()`; live retries come from `describeWorkflowExecution`'s pending-activity
  state, since Temporal doesn't write intermediate retry failures to history.)
- **Temporal Web UI** — **http://localhost:8233**. Each case is a parent workflow (ID = case
  code); chambers are children (`CODE#r1c1`, …). Open a workflow's **Event History** for the
  full picture.

---

Built as a learning project. The Temporal code is small and heavily commented —
`src/workflows.ts` is the place to start reading. `src/protocol.ts` is the one definition of
every shape crossing the wire; the web app re-exports it rather than keeping its own copy, so
the browser and the worker can't drift apart. Batman/Riddler are DC trademarks; this is a
non-commercial fan homage.
