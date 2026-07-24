# 🦇 The Riddler's Game — a co-op escape room on [Temporal](https://temporal.io)

The Bat-Family is trapped in three of the Riddler's chambers. Clear all three together
before the clock runs out. It's a game — but every mechanic is a Temporal primitive, so
it doubles as a hands-on tour of durable execution.

The headline moment: **kill the worker mid-game and the whole case survives** — timer,
chamber progress, and all — because Temporal replays it from event history.

---

## How the escape maps onto Temporal

```
escapeWorkflow  (parent, workflowId = case code)      ← roster, the shared deadline, timed taunts
│   spawns one child workflow per chamber, in order
├─► child  #r1c1  The Riddle Lock    → Signals in / Query out (workflow holds a secret code)
├─► child  #r1c2  The Deathtrap      → Saga + compensation (a miss re-arms your last wire)
└─► child  #r1c3  The Final Escape   → Activity retries + backoff, then a co-op hold
        ESCAPE = all three children cleared before the shared deadline
        "Play again" → Continue-As-New (same case code, fresh history, round #r2…)
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

## Watch the workflows

Two ways to see the Temporal execution as you play:

- **In-app** — flip the **○ workflow** toggle in the top bar. A side panel streams a digested
  live trace of the parent + active child: signals landing, durable timers, child chambers
  spawning, the vault activity **retrying with backoff**, and continue-as-new. (History comes
  from `fetchHistory()`; live retries come from `describeWorkflowExecution`'s pending-activity
  state, since Temporal doesn't write intermediate retry failures to history.)
- **Temporal Web UI** — **http://localhost:8233**. Each case is a parent workflow (ID = case
  code); chambers are children (`CODE#r1c1`, …). Open a workflow's **Event History** for the
  full picture.

---

Built as a learning project. The Temporal code is small and heavily commented —
`src/workflows.ts` is the place to start reading. Batman/Riddler are DC trademarks; this is a
non-commercial fan homage.
