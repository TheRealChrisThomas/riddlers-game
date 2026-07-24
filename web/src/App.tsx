import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ambient } from './Ambient';
import { Riddler, RoleAvatar, VictoryBats, type RiddlerMood } from './pixel';
import {
  ChamberResponse,
  ChamberState,
  ChamberType,
  DeathtrapData,
  EscapeData,
  RiddleData,
  Role,
  ROLE_LABEL,
  ROLES,
  ShellResponse,
  ShellState,
  TraceEvent,
} from './types';

const POLL_MS = 1000;

// The Riddler's taunt when you enter each chamber (shown as a pop-up dialog).
const RIDDLER: Record<ChamberType, string> = {
  riddle:
    "Riddle me this, Bat-Family… a four-digit truth, each digit one to six. Guess, and I'll tell you how close you dance to death.",
  deathtrap:
    'Cut my wires in order, in rhythm. One clumsy hand and the whole circuit surges back to life. Tick… tick… tick…',
  escape:
    'The vault answers only to my machine. Override it — if it lets you — then hold the exit together, or die apart. Ha ha ha!',
};

// --- API helpers ---
const post = (path: string, body?: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

async function createCase(durationMinutes: number): Promise<string> {
  const r = await post('/api/cases', { durationMinutes });
  if (!r.ok) throw new Error('could not create case');
  return (await r.json()).code as string;
}
const joinCase = (code: string, operator: string) => post(`/api/cases/${code}/join`, { operator });
const setRoleReq = (code: string, operator: string, role: Role) => post(`/api/cases/${code}/role`, { operator, role });
const startCase = (code: string) => post(`/api/cases/${code}/start`);
const replayCase = (code: string) => post(`/api/cases/${code}/replay`);
const chamberAction = (code: string, operator: string, action: string, value?: unknown) =>
  post(`/api/cases/${code}/chamber/action`, { operator, action, value });

async function getShell(code: string): Promise<ShellResponse | null> {
  const r = await fetch(`/api/cases/${code}/shell`);
  if (r.status === 404) throw new Error('Case not found');
  if (!r.ok) return null;
  return (await r.json()) as ShellResponse;
}
async function getChamber(code: string): Promise<ChamberResponse | null> {
  const r = await fetch(`/api/cases/${code}/chamber`);
  if (!r.ok) return null;
  return (await r.json()) as ChamberResponse;
}

// ============================================================================
export function App() {
  const params = new URLSearchParams(location.search);
  const [operator, setOperator] = useState(localStorage.getItem('operator') ?? '');
  const [code, setCode] = useState(params.get('case') ?? '');
  const [joined, setJoined] = useState(false);

  return (
    <>
      <Ambient />
      {!joined ? (
        <Lobby
          operator={operator}
          code={code}
          setOperator={setOperator}
          setCode={setCode}
          onEnter={(c, op) => {
            localStorage.setItem('operator', op);
            history.replaceState(null, '', `?case=${c}`);
            setCode(c);
            setOperator(op);
            setJoined(true);
          }}
        />
      ) : (
        <Case code={code} operator={operator} onLeave={() => setJoined(false)} />
      )}
    </>
  );
}

// --- Lobby: name + create/join ---
function Lobby(props: {
  operator: string;
  code: string;
  setOperator: (v: string) => void;
  setCode: (v: string) => void;
  onEnter: (code: string, operator: string) => void;
}) {
  const { operator, code, setOperator, setCode, onEnter } = props;
  const [minutes, setMinutes] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameOk = operator.trim().length > 0;

  const create = async () => {
    if (!nameOk) return setError('Enter your name first.');
    setBusy(true);
    setError('');
    try {
      const c = await createCase(minutes);
      await joinCase(c, operator.trim());
      onEnter(c, operator.trim());
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    if (!nameOk) return setError('Enter your name first.');
    if (!code.trim()) return setError('Enter a case code.');
    setBusy(true);
    setError('');
    try {
      await joinCase(code.trim().toUpperCase(), operator.trim());
      onEnter(code.trim().toUpperCase(), operator.trim());
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <div className="card">
        <h1 className="logo">
          <span className="q">?</span> THE RIDDLER'S GAME
        </h1>
        <p className="tagline">
          A co-op escape room running on Temporal. The Bat-Family is trapped in three chambers. Clear them
          together before the clock runs out.
        </p>

        <label className="field">
          <span>Your name</span>
          <input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder="e.g. Chris" maxLength={20} />
        </label>

        <div className="split">
          <div className="pane">
            <h2>Start a case</h2>
            <label className="field">
              <span>Timer: {minutes} min</span>
              <input type="range" min={3} max={30} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </label>
            <button className="primary" disabled={busy} onClick={create}>
              Open the case
            </button>
          </div>
          <div className="pane">
            <h2>Join a case</h2>
            <label className="field">
              <span>Case code</span>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXXX" maxLength={5} />
            </label>
            <button className="ghost" disabled={busy} onClick={join}>
              Join
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

// --- Case: polls shell + chamber, routes by status ---
function Case(props: { code: string; operator: string; onLeave: () => void }) {
  const { code, operator, onLeave } = props;
  const [shellResp, setShellResp] = useState<ShellResponse | null>(null);
  const [chamberResp, setChamberResp] = useState<ChamberResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fatal, setFatal] = useState('');
  const [dialog, setDialog] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(localStorage.getItem('showTrace') === '1');
  const [moodFlash, setMoodFlash] = useState<RiddlerMood | null>(null);
  const shownDialog = useRef('');
  const lastTaunt = useRef(0);
  const prevChamber = useRef(0);
  const busy = useRef(false);

  const toggleTrace = () => {
    setShowTrace((v) => {
      localStorage.setItem('showTrace', v ? '0' : '1');
      return !v;
    });
  };

  // Pop the Riddler's dialog whenever a new chamber begins.
  useEffect(() => {
    const s = shellResp?.shell;
    if (s?.status === 'in_chamber' && s.chamberType) {
      const key = `c${s.chamberIndex}`;
      if (key !== shownDialog.current) {
        shownDialog.current = key;
        setDialog(RIDDLER[s.chamberType]);
      }
    }
  }, [shellResp?.shell.status, shellResp?.shell.chamberIndex, shellResp?.shell.chamberType]);

  // Timed taunts pushed by the workflow → pop them as dialogs too.
  useEffect(() => {
    const t = shellResp?.shell.taunt;
    if (t && t.id !== lastTaunt.current) {
      lastTaunt.current = t.id;
      if (t.id > 0) setDialog(t.text);
    }
  }, [shellResp?.shell.taunt?.id]);

  // Riddler scowls briefly each time you clear a chamber.
  useEffect(() => {
    const idx = shellResp?.shell.chamberIndex ?? 0;
    if (shellResp?.shell.status === 'in_chamber' && idx > prevChamber.current) {
      setMoodFlash('scowl');
      const t = setTimeout(() => setMoodFlash(null), 2600);
      prevChamber.current = idx;
      return () => clearTimeout(t);
    }
    prevChamber.current = idx;
  }, [shellResp?.shell.chamberIndex, shellResp?.shell.status]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const s = await getShell(code);
        if (alive && s) {
          setShellResp(s);
          if (s.shell.status === 'in_chamber') {
            const c = await getChamber(code);
            if (alive && c) setChamberResp(c);
          }
        }
      } catch (e) {
        if (alive) setFatal(String((e as Error).message));
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  if (fatal) return <Centered><p className="error">{fatal}</p><button className="ghost" onClick={onLeave}>Back</button></Centered>;
  if (!shellResp) return <Centered><p className="tagline">Connecting to case {code}…</p></Centered>;

  const shell = shellResp.shell;
  const workerDown = !shellResp.workerReachable || (chamberResp ? !chamberResp.workerReachable : false);
  const chamberData = chamberResp?.chamber?.data;
  const baseMood: RiddlerMood =
    shell.status === 'escaped'
      ? 'defeat'
      : shell.status === 'failed'
        ? 'gloat'
        : chamberData?.kind === 'deathtrap' && chamberData.compensating
          ? 'cackle'
          : dialog
            ? 'cackle'
            : 'idle';
  const mascotMood = moodFlash ?? baseMood;
  const remainingMs = shell.deadlineEpochMs ? shell.deadlineEpochMs - now : Infinity;
  const danger = shell.status === 'in_chamber' && remainingMs < 30_000;

  return (
    <div className="shell room">
      {dialog && <RiddlerDialog message={dialog} onClose={() => setDialog(null)} />}
      {danger && <div className="danger-pulse" aria-hidden />}
      {shell.status === 'escaped' && <VictoryBats />}
      <div className="mascot">
        <Riddler mood={mascotMood} size={112} />
      </div>
      {showTrace && <TracePanel code={code} onClose={toggleTrace} />}
      {workerDown && (
        <div className="banner">
          ⚠️ Worker offline — the board is frozen, but the clock keeps running. Restart the worker and watch the case
          pick up exactly where it left off. That's Temporal's durable execution.
        </div>
      )}

      <TopBar code={code} onLeave={onLeave} showTrace={showTrace} onToggleTrace={toggleTrace} />

      {shell.status === 'lobby' && <Staging code={code} operator={operator} shell={shell} />}

      {shell.status === 'in_chamber' && (
        <>
          <ChamberHeader shell={shell} now={now} />
          {chamberResp?.chamber ? (
            <Chamber code={code} operator={operator} shell={shell} chamber={chamberResp.chamber} />
          ) : (
            <p className="objective">Sealing the chamber…</p>
          )}
        </>
      )}

      {(shell.status === 'escaped' || shell.status === 'failed') && (
        <EndScreen
          won={shell.status === 'escaped'}
          onReplay={() => {
            shownDialog.current = ''; // let chamber dialogs fire again
            lastTaunt.current = 0;
            replayCase(code);
          }}
        />
      )}

      <LogFeed lines={shell.log} />
    </div>
  );
}

function RiddlerDialog(props: { message: string; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="riddler-head">
          <Riddler mood="cackle" size={64} />
          <span className="riddler-name">THE RIDDLER</span>
        </div>
        <p className="riddler-msg">{props.message}</p>
        <button className="primary" onClick={props.onClose}>Continue</button>
      </div>
    </div>
  );
}

function Centered(props: { children: ReactNode }) {
  return (
    <div className="shell">
      <div className="card">{props.children}</div>
    </div>
  );
}

function TopBar(props: { code: string; onLeave: () => void; showTrace: boolean; onToggleTrace: () => void }) {
  const shareUrl = `${location.origin}/?case=${props.code}`;
  return (
    <div className="topbar">
      <div>
        <span className="muted">CASE</span> <strong className="code">{props.code}</strong>
        <button className="link" onClick={() => navigator.clipboard?.writeText(shareUrl)}>copy invite link</button>
      </div>
      <div>
        <button className={`link ${props.showTrace ? 'on' : ''}`} onClick={props.onToggleTrace}>
          {props.showTrace ? '● workflow' : '○ workflow'}
        </button>
        <button className="link" onClick={props.onLeave}>leave</button>
      </div>
    </div>
  );
}

// Live Temporal trace: digested event history of the parent + active child, streaming in.
function TracePanel(props: { code: string; onClose: () => void }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/cases/${props.code}/trace`);
        if (!r.ok) return;
        const data = (await r.json()) as { events: TraceEvent[] };
        if (alive) setEvents(data.events);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [props.code]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const uiUrl = `http://localhost:8233/namespaces/default/workflows/${props.code}`;
  return (
    <div className="trace">
      <div className="trace-head">
        <span>⚙ TEMPORAL — live workflow trace</span>
        <button className="link" onClick={props.onClose}>hide</button>
      </div>
      <div className="trace-body">
        {events.length === 0 && <div className="trace-empty">Waiting for workflow events…</div>}
        {events.map((e, i) => (
          <div key={i} className={`trace-row k-${e.kind}`}>
            <span className={`trace-wf wf-${e.wf}`}>{e.wf}</span>
            <span className="trace-detail">{e.detail}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <a className="trace-foot" href={uiUrl} target="_blank" rel="noreferrer">open full history in Temporal UI ↗</a>
    </div>
  );
}

// --- Staging lobby: roster, role picker, start ---
function Staging(props: { code: string; operator: string; shell: ShellState }) {
  const { code, operator, shell } = props;
  const me = shell.roster.find((p) => p.operator === operator);
  return (
    <div className="card staging">
      <h2>Assemble the Bat-Family</h2>
      <p className="muted">Everyone picks a role, then anyone can start. Share the case code to bring in your team.</p>
      <div className="roster">
        {shell.roster.map((p) => (
          <div key={p.operator} className={`hero role-${p.role} ${p.operator === operator ? 'me' : ''}`}>
            <RoleAvatar role={p.role} size={44} />
            <div className="hero-text">
              <span className="hero-role">{ROLE_LABEL[p.role]}</span>
              <span className="hero-name">{p.operator}{p.operator === operator ? ' (you)' : ''}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="roles">
        {ROLES.map((r) => (
          <button
            key={r}
            className={`rolebtn role-${r} ${me?.role === r ? 'active' : ''}`}
            onClick={() => setRoleReq(code, operator, r)}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <button className="primary" onClick={() => startCase(code)}>Begin the escape</button>
    </div>
  );
}

// --- Shell header while in a chamber ---
function ChamberHeader(props: { shell: ShellState; now: number }) {
  const { shell, now } = props;
  const remaining = Math.max(0, (shell.deadlineEpochMs ?? now) - now);
  const s = Math.ceil(remaining / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const danger = remaining < 30_000;
  return (
    <>
      <div className="progress">
        {Array.from({ length: shell.chamberTotal }, (_, i) => (
          <span key={i} className={`step ${i < shell.chamberIndex ? 'done' : i === shell.chamberIndex ? 'active' : ''}`} />
        ))}
        <span className="progress-label">
          Chamber {shell.chamberIndex + 1}/{shell.chamberTotal} — {shell.chamberTitle}
        </span>
      </div>
      <div className={`clock ${danger ? 'danger' : ''}`}>{mm}:{ss}</div>
    </>
  );
}

// --- Chamber router ---
function Chamber(props: { code: string; operator: string; shell: ShellState; chamber: ChamberState }) {
  const { code, operator, shell, chamber } = props;
  if (chamber.data.kind === 'riddle') return <RiddleChamber code={code} operator={operator} data={chamber.data} />;
  if (chamber.data.kind === 'deathtrap')
    return <DeathtrapChamber code={code} operator={operator} shell={shell} data={chamber.data} />;
  return <EscapeChamber code={code} operator={operator} data={chamber.data} />;
}

// --- Chamber 1: riddle / code cracker ---
function RiddleChamber(props: { code: string; operator: string; data: RiddleData }) {
  const { code, operator, data } = props;
  const [digits, setDigits] = useState<number[]>([]);
  const submit = () => {
    if (digits.length !== data.codeLength) return;
    chamberAction(code, operator, 'guess', digits);
    setDigits([]);
  };
  return (
    <div className="chamber">
      <p className="objective">{data.prompt}</p>
      {data.answer && (
        <button className="devhint" onClick={() => setDigits(data.answer!)}>
          🔧 dev: code is {data.answer.join(' ')} — click to autofill
        </button>
      )}
      <div className="guess-slots">
        {Array.from({ length: data.codeLength }, (_, i) => (
          <div key={i} className={`slot ${digits[i] ? 'filled' : ''}`}>{digits[i] ?? ''}</div>
        ))}
      </div>
      <div className="keypad">
        {Array.from({ length: data.digitMax }, (_, i) => i + 1).map((n) => (
          <button key={n} className="key" disabled={digits.length >= data.codeLength} onClick={() => setDigits([...digits, n])}>
            {n}
          </button>
        ))}
        <button className="key clear" onClick={() => setDigits(digits.slice(0, -1))}>⌫</button>
        <button className="key submit" disabled={digits.length !== data.codeLength} onClick={submit}>
          Guess
        </button>
      </div>
      <div className="guesses">
        {data.guesses.slice().reverse().map((g, i) => (
          <div key={i} className="grow">
            <span className="gdigits">{g.digits.join(' ')}</span>
            <span className="feedback">
              {'●'.repeat(g.exact)}
              <span className="partial">{'○'.repeat(g.partial)}</span>
              {'·'.repeat(data.codeLength - g.exact - g.partial)}
            </span>
            <span className="gby">{g.by}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Chamber 2: deathtrap / saga — cut each wire in-rhythm; a miss surges (compensation) ---
function DeathtrapChamber(props: { code: string; operator: string; shell: ShellState; data: DeathtrapData }) {
  const { code, operator, shell, data } = props;
  const myRole = shell.roster.find((p) => p.operator === operator)?.role;
  const partyRoles = new Set(shell.roster.map((p) => p.role));

  // Optimistic advance: on a hit we jump to the next wire immediately, before the poll
  // confirms it. Reconcile when the server catches up or a surge resets us.
  const [optimistic, setOptimistic] = useState<number | null>(null);
  useEffect(() => {
    if (optimistic != null && (data.compensating || data.nextIndex >= optimistic)) setOptimistic(null);
  }, [data.nextIndex, data.compensating, optimistic]);

  const displayIndex = data.compensating ? data.nextIndex : Math.max(data.nextIndex, optimistic ?? 0);
  const current = data.steps[displayIndex];
  const canActNow = !!current && (current.role === myRole || !partyRoles.has(current.role));

  // Escalate gently: the green zone shrinks and the sweep speeds up as you get deeper,
  // but stays forgiving enough to be fun rather than punishing.
  const zoneWidth = Math.max(0.16, 0.34 - displayIndex * 0.035);
  const periodMs = Math.max(900, 1600 - displayIndex * 160);

  return (
    <div className={`chamber ${data.compensating ? 'compensating' : ''}`}>
      <p className="objective">
        Cut all four wires in order. Time each cut inside the green zone — miss, and the last wire snaps back one step.
      </p>

      <div className="wires">
        {data.steps.map((s, i) => {
          const cut = s.engaged || i < displayIndex;
          const active = i === displayIndex && !data.compensating;
          return (
            <div key={s.id} className={`wire role-${s.role} ${cut ? 'cut' : ''} ${active ? 'active' : ''}`}>
              <span className="wire-role">{ROLE_LABEL[s.role]}</span>
              <span className="wire-label">{s.label}</span>
              <span className="wire-state">{cut ? '✓ cut' : active ? 'live' : 'armed'}</span>
            </div>
          );
        })}
      </div>

      {data.compensating && <p className="alert">⚡ SURGE — that wire snapped back…</p>}

      {!data.compensating && current && (
        canActNow ? (
          <TimingBar
            key={displayIndex}
            label={`${current.label} (${displayIndex + 1}/${data.steps.length})`}
            zoneWidth={zoneWidth}
            periodMs={periodMs}
            onResult={(hit) => {
              if (hit) {
                chamberAction(code, operator, 'disarm', current.id);
                setOptimistic(displayIndex + 1);
              } else {
                chamberAction(code, operator, 'surge');
                setOptimistic(null);
              }
            }}
          />
        ) : (
          <p className="objective waiting">Waiting for <strong>{ROLE_LABEL[current.role]}</strong> to cut “{current.label}”…</p>
        )
      )}
    </div>
  );
}

// A sweeping timing meter. Click CUT while the marker is in the green zone.
function TimingBar(props: { label: string; zoneWidth: number; periodMs: number; onResult: (hit: boolean) => void }) {
  const { label, zoneWidth, periodMs, onResult } = props;
  const zoneStart = 0.5 - zoneWidth / 2;
  const zoneEnd = 0.5 + zoneWidth / 2;
  const [pos, setPos] = useState(0);
  const posRef = useRef(0);
  const [result, setResult] = useState<null | 'hit' | 'miss'>(null);
  const locked = useRef(false);
  const resetTimer = useRef(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      const phase = ((t - start) % periodMs) / periodMs; // 0..1
      const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2; // triangle 0..1..0
      posRef.current = tri;
      if (!locked.current) setPos(tri);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resetTimer.current);
    };
  }, [periodMs]);

  const cut = () => {
    if (locked.current) return;
    locked.current = true;
    const hit = posRef.current >= zoneStart && posRef.current <= zoneEnd;
    setResult(hit ? 'hit' : 'miss');
    onResult(hit);
    // On a hit, stay locked until the server advances us to the next wire (remount).
    // On a miss (surge), show it for a beat, then let them try again.
    if (!hit) {
      resetTimer.current = window.setTimeout(() => {
        setResult(null);
        locked.current = false;
      }, 2000);
    }
  };

  return (
    <div className="timing">
      <div className="timing-label">{label}</div>
      <div className="timing-track">
        <div className="timing-zone" style={{ left: `${zoneStart * 100}%`, width: `${zoneWidth * 100}%` }} />
        <div className="timing-marker" style={{ left: `${pos * 100}%` }} />
      </div>
      <button className={`cut-btn ${result ?? ''}`} onClick={cut} disabled={!!result}>
        {result === 'hit' ? '✓ CLEAN CUT' : result === 'miss' ? '⚡ SURGE!' : 'CUT WIRE'}
      </button>
    </div>
  );
}

// --- Chamber 3: final escape / retries + co-op hold ---
function EscapeChamber(props: { code: string; operator: string; data: EscapeData }) {
  const { code, operator, data } = props;
  const hold = useCallback((on: boolean) => chamberAction(code, operator, 'hold', on), [code, operator]);

  if (data.phase === 'override') {
    return (
      <div className="chamber">
        <p className="objective">Override the vault lock. The Riddler's machine will fight back.</p>
        {!data.overrideStarted ? (
          <button className="primary big" onClick={() => chamberAction(code, operator, 'reboot')}>
            ⚡ Initiate override
          </button>
        ) : (
          <div className="override">
            <div className="spinner" />
            <p className="muted">
              Override in progress — the lock keeps rejecting us. Temporal is auto-retrying the activity with backoff.
              <br />
              Watch it live in the Temporal UI at <code>localhost:8233</code>.
            </p>
          </div>
        )}
      </div>
    );
  }

  // phase 'hold' (or 'open')
  return (
    <div className="chamber">
      {data.overrideAttempts != null && (
        <p className="objective">Vault override succeeded after {data.overrideAttempts} attempts. Now hold the exit together.</p>
      )}
      <div className="holders">
        {data.operators.map((op) => (
          <div key={op} className={`hold-chip ${data.holders[op] ? 'on' : ''} ${op === operator ? 'me' : ''}`}>
            {op}{op === operator ? ' (you)' : ''} — {data.holders[op] ? 'HOLDING' : 'waiting'}
          </div>
        ))}
      </div>
      <ChargeButton onArmedChange={hold} />
    </div>
  );
}

// --- reused hold-to-charge ring (the finale) ---
function ChargeButton(props: { onArmedChange: (on: boolean) => void }) {
  const CHARGE_MS = 2400;
  const DRAIN_MS = 550;
  const [charge, setCharge] = useState(0);
  const holding = useRef(false);
  const armed = useRef(false);
  const cb = useRef(props.onArmedChange);
  cb.current = props.onArmedChange;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = t - last;
      last = t;
      setCharge((c) => {
        const delta = holding.current ? dt / CHARGE_MS : -dt / DRAIN_MS;
        const next = Math.min(1, Math.max(0, c + delta));
        const armedNow = holding.current && next >= 1;
        if (armedNow !== armed.current) {
          armed.current = armedNow;
          cb.current(armedNow);
        }
        return next;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (armed.current) cb.current(false);
    };
  }, []);

  const isArmed = charge >= 1;
  return (
    <div className="charge-wrap">
      <button
        className={`charge ${isArmed ? 'armed' : charge > 0 ? 'charging' : ''}`}
        style={{ '--pct': String(charge) } as CSSProperties}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          holding.current = true;
        }}
        onPointerUp={() => (holding.current = false)}
        onPointerCancel={() => (holding.current = false)}
        onLostPointerCapture={() => (holding.current = false)}
      >
        <span className="charge-ring" aria-hidden />
        <span className="charge-label">{isArmed ? 'HOLDING\nkeep it down' : charge > 0 ? `${Math.round(charge * 100)}%` : 'HOLD\nTHE EXIT'}</span>
      </button>
      <p className="hint">Every hero must hold the exit at the same moment.</p>
    </div>
  );
}

function EndScreen(props: { won: boolean; onReplay: () => void }) {
  return (
    <div className={`overlay ${props.won ? 'won' : 'lost'}`}>
      {props.won && (
        <div className="vault" aria-hidden>
          <div className="vault-door left" />
          <div className="vault-door right" />
        </div>
      )}
      <h2>{props.won ? '🦇 THE BAT-FAMILY ESCAPES' : '☠️ THE RIDDLER WINS'}</h2>
      <p className="muted">
        {props.won ? 'All three chambers cleared before the clock.' : 'The trap sprang before you got out.'}
      </p>
      <button className="primary" onClick={props.onReplay}>
        {props.won ? 'Play again' : 'Try again'}
      </button>
      <p className="muted small">Same case code — the Riddler resets his chambers.</p>
    </div>
  );
}

function LogFeed(props: { lines: string[] }) {
  return (
    <div className="log">
      {props.lines.slice(-8).map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
