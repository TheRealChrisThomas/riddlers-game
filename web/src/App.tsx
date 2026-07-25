import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ambient } from './Ambient';
import { BatEmblem, HeroMascot, Riddler, RoleAvatar, VictoryBats, type HeroMood, type RiddlerMood } from './pixel';
import {
  BatcomputerState,
  ChamberResponse,
  ChamberState,
  ChamberType,
  DeathtrapData,
  EscapeData,
  HubResponse,
  RiddleData,
  Role,
  ROLE_LABEL,
  ROLES,
  ShellResponse,
  ShellState,
  TraceEvent,
  VILLAIN_META,
  VILLAINS,
  Villain,
  VillainStatus,
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

const RIDDLER_DEFEAT =
  "Tick… tock… stopped. Riddle me this, Bat-Family: what's colder than my laughter? Your defeat. The trap wins, and I remain forever unsolved. HA HA HA!";

const RIDDLER_CONCEDE =
  'No… NO! My perfect puzzle — solved?! Enjoy the night, Bat-Family. But every riddle you answer only makes the next one deadlier…';

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
const batSignalReq = (code: string, villain: Villain) => post(`/api/cases/${code}/batsignal`, { villain });
const chamberAction = (code: string, operator: string, action: string, value?: unknown) =>
  post(`/api/cases/${code}/chamber/action`, { operator, action, value });

async function getHub(code: string): Promise<HubResponse | null> {
  const r = await fetch(`/api/cases/${code}/hub`);
  if (r.status === 404) throw new Error('Case not found');
  if (!r.ok) return null;
  return (await r.json()) as HubResponse;
}
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
        <Batcomputer code={code} operator={operator} onLogout={() => setJoined(false)} />
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
          <span className="q">?</span> BATMAN ADVENTURES
        </h1>
        <p className="tagline">
          Co-op escape rooms running on Temporal. Boot the Bat-computer, gather the Bat-Family, and light the
          signal on a villain. Each case is its own durable workflow.
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
function Case(props: { code: string; operator: string; villain: Villain; onBackToHub: () => void }) {
  const { code, operator, villain, onBackToHub } = props;
  const [shellResp, setShellResp] = useState<ShellResponse | null>(null);
  const [chamberResp, setChamberResp] = useState<ChamberResponse | null>(null);
  const [now, setNow] = useState(Date.now());
  const [fatal, setFatal] = useState('');
  const [dialog, setDialog] = useState<string | null>(null); // chamber intros → center modal
  const [bubble, setBubble] = useState<string | null>(null); // timed taunts → speech bubble
  const [showTrace, setShowTrace] = useState(localStorage.getItem('showTrace') === '1');
  const [moodFlash, setMoodFlash] = useState<RiddlerMood | null>(null);
  const shownDialog = useRef('');
  const lastTaunt = useRef(0);
  const bubbleTimer = useRef(0);
  const prevChamber = useRef(0);
  const busy = useRef(false);

  const toggleTrace = () => {
    setShowTrace((v) => {
      localStorage.setItem('showTrace', v ? '0' : '1');
      return !v;
    });
  };

  // Pop the Riddler's dialog when a new chamber begins, or when he wins.
  useEffect(() => {
    const s = shellResp?.shell;
    if (!s) return;
    if (s.status === 'in_chamber' && s.chamberType) {
      const key = `c${s.chamberIndex}`;
      if (key !== shownDialog.current) {
        shownDialog.current = key;
        setDialog(RIDDLER[s.chamberType]);
      }
    } else if (s.status === 'failed' && shownDialog.current !== 'defeat') {
      shownDialog.current = 'defeat';
      setDialog(RIDDLER_DEFEAT);
    } else if (s.status === 'escaped' && shownDialog.current !== 'concede') {
      // he loses: mutter a bitter concession from the corner (bubble, not a blocking modal)
      shownDialog.current = 'concede';
      setBubble(RIDDLER_CONCEDE);
      clearTimeout(bubbleTimer.current);
      bubbleTimer.current = window.setTimeout(() => setBubble(null), 12000);
    }
  }, [shellResp?.shell?.status, shellResp?.shell?.chamberIndex, shellResp?.shell?.chamberType]);

  // Timed taunts pushed by the workflow → speech bubble over the Riddler that auto-fades.
  useEffect(() => {
    const t = shellResp?.shell?.taunt;
    if (t && t.id !== lastTaunt.current) {
      lastTaunt.current = t.id;
      if (t.id > 0) {
        setBubble(t.text);
        clearTimeout(bubbleTimer.current);
        bubbleTimer.current = window.setTimeout(() => setBubble(null), 7000);
      }
    }
  }, [shellResp?.shell?.taunt?.id]);

  useEffect(() => () => clearTimeout(bubbleTimer.current), []);

  // Riddler scowls briefly each time you clear a chamber.
  useEffect(() => {
    const idx = shellResp?.shell?.chamberIndex ?? 0;
    if (shellResp?.shell?.status === 'in_chamber' && idx > prevChamber.current) {
      setMoodFlash('scowl');
      const t = setTimeout(() => setMoodFlash(null), 2600);
      prevChamber.current = idx;
      return () => clearTimeout(t);
    }
    prevChamber.current = idx;
  }, [shellResp?.shell?.chamberIndex, shellResp?.shell?.status]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const s = await getShell(code);
        if (alive && s) {
          setShellResp(s);
          if (s.shell?.status === 'in_chamber') {
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

  if (fatal) return <Centered><p className="error">{fatal}</p><button className="ghost" onClick={onBackToHub}>Back to Bat-computer</button></Centered>;
  if (!shellResp || !shellResp.shell) return <Centered><p className="tagline">Entering the {VILLAIN_META[villain].name} case…</p></Centered>;

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
          : dialog || bubble
            ? 'cackle'
            : 'idle';
  const mascotMood = moodFlash ?? baseMood;
  const myHero = shell.roster.find((p) => p.operator === operator)?.role;
  const heroMood: HeroMood =
    shell.status === 'escaped'
      ? 'cheer'
      : shell.status === 'failed'
        ? 'defeat'
        : moodFlash === 'scowl' // a chamber was just cleared
          ? 'cheer'
          : chamberData?.kind === 'deathtrap' && chamberData.compensating
            ? 'flinch'
            : 'idle';
  const remainingMs = shell.deadlineEpochMs ? shell.deadlineEpochMs - now : Infinity;
  const danger = shell.status === 'in_chamber' && remainingMs < 30_000;

  return (
    <div className={`shell room${showTrace ? ' trace-open' : ''}`}>
      {dialog && <RiddlerDialog message={dialog} onClose={() => setDialog(null)} />}
      {danger && <div className="danger-pulse" aria-hidden />}
      {shell.status === 'escaped' && <VictoryBats />}
      <div className="mascot">
        {bubble && <div className="speech" onClick={() => setBubble(null)}>{bubble}</div>}
        <Riddler mood={mascotMood} size={112} />
      </div>
      {myHero && (
        <div className="mascot mascot-right">
          <HeroMascot role={myHero} mood={heroMood} size={112} />
        </div>
      )}
      {showTrace && <TracePanel code={code} onClose={toggleTrace} />}
      {workerDown && (
        <div className="banner">
          ⚠️ Worker offline — the board is frozen, but the clock keeps running. Restart the worker and watch the case
          pick up exactly where it left off. That's Temporal's durable execution.
        </div>
      )}

      <TopBar code={code} villainLabel={VILLAIN_META[villain].name} onBack={onBackToHub} showTrace={showTrace} onToggleTrace={toggleTrace} />

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
            batSignalReq(code, villain); // re-light the signal → a fresh adventure run
          }}
          onBackToHub={onBackToHub}
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

function TopBar(props: { code: string; villainLabel: string; onBack: () => void; showTrace: boolean; onToggleTrace: () => void }) {
  const shareUrl = `${location.origin}/?case=${props.code}`;
  return (
    <div className="topbar">
      <div>
        <button className="link" onClick={props.onBack}>◂ Bat-computer</button>
        <span className="muted"> · CASE</span> <strong className="code">{props.code}</strong>
        <span className="muted"> · {props.villainLabel}</span>
        <button className="link" onClick={() => navigator.clipboard?.writeText(shareUrl)}>copy invite link</button>
      </div>
      <div>
        <button className={`link ${props.showTrace ? 'on' : ''}`} onClick={props.onToggleTrace}>
          {props.showTrace ? '● workflow' : '○ workflow'}
        </button>
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

// ============================================================================
// Batcomputer: the hub. Polls the grandparent workflow, assembles the team,
// and routes into the active adventure. Picking a villain fires the Bat-Signal.
// ============================================================================
function Batcomputer(props: { code: string; operator: string; onLogout: () => void }) {
  const { code, operator, onLogout } = props;
  const [hubResp, setHubResp] = useState<HubResponse | null>(null);
  const [fatal, setFatal] = useState('');
  const [dismissedAdv, setDismissedAdv] = useState<string | null>(null);
  const [signalling, setSignalling] = useState<Villain | null>(null);
  const [showTrace, setShowTrace] = useState(localStorage.getItem('showTrace') === '1');
  const joined = useRef(false);
  const busy = useRef(false);

  const toggleTrace = () =>
    setShowTrace((v) => {
      localStorage.setItem('showTrace', v ? '0' : '1');
      return !v;
    });

  // Ensure we're on the roster (idempotent), then poll the hub.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (!joined.current) {
          await joinCase(code, operator);
          joined.current = true;
        }
        const h = await getHub(code);
        if (alive && h) setHubResp(h);
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
  }, [code, operator]);

  if (fatal)
    return (
      <Centered>
        <p className="error">{fatal}</p>
        <button className="ghost" onClick={onLogout}>Back</button>
      </Centered>
    );
  if (!hubResp) return <Centered><p className="tagline">Booting the Bat-computer… case {code}</p></Centered>;

  const hub = hubResp.hub;
  const activeAdv = hub.activeAdventureId;
  const inAdventure = !!activeAdv && activeAdv !== dismissedAdv && hub.activeVillain;

  // An adventure is live (or freshly ended) → drop into the case view.
  if (inAdventure) {
    return <Case code={code} operator={operator} villain={hub.activeVillain!} onBackToHub={() => setDismissedAdv(activeAdv)} />;
  }

  const me = hub.roster.find((p) => p.operator === operator);
  const canLaunch = hub.roster.length > 0;

  const fire = (villain: Villain) => {
    if (VILLAIN_META[villain].locked || !canLaunch) return;
    setDismissedAdv(null); // re-arm routing so the next launch drops us in
    setSignalling(villain); // play the beam, then send the real signal
  };

  return (
    <div className="shell room hub">
      {signalling && (
        <BatSignal
          villain={signalling}
          onDone={() => {
            batSignalReq(code, signalling);
            setSignalling(null);
          }}
        />
      )}
      {showTrace && <TracePanel code={code} onClose={toggleTrace} />}

      <div className="topbar">
        <div>
          <span className="muted">BAT-COMPUTER · CASE</span> <strong className="code">{code}</strong>
          <button className="link" onClick={() => navigator.clipboard?.writeText(`${location.origin}/?case=${code}`)}>copy invite link</button>
        </div>
        <div>
          <span className="hub-score">SCORE {hub.score}</span>
          <button className={`link ${showTrace ? 'on' : ''}`} onClick={toggleTrace}>
            {showTrace ? '● workflow' : '○ workflow'}
          </button>
          <button className="link" onClick={onLogout}>leave</button>
        </div>
      </div>

      <div className="card staging">
        <h2>Assemble the Bat-Family</h2>
        <p className="muted">Pick your role, then light the signal on a case file. Share the code to bring in your team.</p>
        <div className="roster">
          {hub.roster.map((p) => (
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
      </div>

      <div className="card casefiles">
        <h2>Case files</h2>
        <p className="muted">Each villain is its own Temporal workflow. Light the signal to begin.</p>
        <div className="villain-grid">
          {VILLAINS.map((v) => (
            <VillainTile
              key={v}
              villain={v}
              status={hub.statuses[v]}
              canLaunch={canLaunch}
              onFire={() => fire(v)}
            />
          ))}
        </div>
        {!canLaunch && <p className="hint">Assemble at least one hero before you can light the signal.</p>}
      </div>

      <LogFeed lines={hub.log} />
    </div>
  );
}

const STATUS_LABEL: Record<VillainStatus, string> = {
  idle: 'Awaiting the signal',
  running: 'In progress…',
  escaped: 'Solved ✓',
  failed: 'Case still open',
};

function VillainTile(props: { villain: Villain; status: VillainStatus; canLaunch: boolean; onFire: () => void }) {
  const meta = VILLAIN_META[props.villain];
  const disabled = meta.locked || !props.canLaunch;
  return (
    <button
      className={`villain-tile v-${props.villain} ${meta.locked ? 'locked' : ''} status-${props.status}`}
      disabled={disabled}
      onClick={props.onFire}
    >
      <span className="villain-glyph" aria-hidden>{meta.locked ? '🔒' : meta.glyph}</span>
      <span className="villain-name">{meta.name}</span>
      <span className="villain-tagline">{meta.locked ? 'CASE FILE SEALED' : meta.tagline}</span>
      <span className="villain-concept">{meta.concept}</span>
      {!meta.locked && <span className={`villain-status vs-${props.status}`}>{STATUS_LABEL[props.status]}</span>}
    </button>
  );
}

// The Bat-Signal: a searchlight beam throws a glowing disc of light onto the Gotham
// night sky with the black bat emblem projected inside it, then the villain answers
// and the real Temporal signal is sent (see onDone). Pure client-side flourish.
function BatSignal(props: { villain: Villain; onDone: () => void }) {
  const meta = VILLAIN_META[props.villain];
  useEffect(() => {
    const t = setTimeout(props.onDone, 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="batsignal-overlay" aria-hidden>
      <div className="batsignal-sky" />
      <div className="batsignal-beam" />
      <div className="batsignal-signal">
        <div className="batsignal-disc" />
        <BatEmblem color="#0a0d07" size={200} className="batsignal-bat" />
      </div>
      <div className="batsignal-caption">
        <div className="batsignal-name">{meta.name} answers the signal</div>
        <div className="batsignal-taunt">“{meta.intro}”</div>
      </div>
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
              <div className="wire-head">
                <span className="wire-role">{ROLE_LABEL[s.role]}</span>
                <span className="wire-state">{cut ? '✓ cut' : active ? 'live' : 'armed'}</span>
              </div>
              <span className="wire-label">{s.label}</span>
              <div className="wire-line" aria-hidden>
                <span className="node" />
                <span className="strand">
                  <i className="half left" />
                  <i className="half right" />
                  <i className="pulse" />
                  <i className="cut-spark" />
                </span>
                <span className="node" />
              </div>
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

  return (
    <div className="chamber">
      <div className="vault-stage">
        {data.phase === 'override' ? (
          !data.overrideStarted ? (
            <div className="vault-frame">
              <div className="vault-readout">LOCKED</div>
              <div className="vault-keypad">
                {Array.from({ length: 12 }, (_, i) => (
                  <span key={i} className="vkey dim" />
                ))}
              </div>
              <button className="primary big" onClick={() => chamberAction(code, operator, 'reboot')}>
                ⚡ Initiate override
              </button>
            </div>
          ) : (
            <div className="vault-frame">
              <VaultFight attempt={data.attempt} />
              <p className="muted small">
                Temporal is auto-retrying the override activity with backoff. Flip on the ⚙ workflow trace to watch the
                real attempts.
              </p>
            </div>
          )
        ) : (
          <VaultReveal>
            {data.overrideAttempts != null && (
              <p className="objective">Vault cracked on attempt {data.overrideAttempts}. Hold the exit together!</p>
            )}
            <ChargeButton onArmedChange={hold} />
            <div className="holders">
              {data.operators.map((op) => (
                <div key={op} className={`hold-chip ${data.holders[op] ? 'on' : ''} ${op === operator ? 'me' : ''}`}>
                  {op}
                  {op === operator ? ' (you)' : ''} — {data.holders[op] ? 'HOLDING' : 'waiting'}
                </div>
              ))}
            </div>
          </VaultReveal>
        )}
      </div>
    </div>
  );
}

// The vault lock fighting back while Temporal retries: scrambling code, red keypad,
// periodic "ACCESS DENIED" shakes, sparks.
function VaultFight(props: { attempt?: number }) {
  const [readout, setReadout] = useState('0000');
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n++;
      setReadout(Array.from({ length: 4 }, () => Math.floor(Math.random() * 10)).join(''));
      if (n % 7 === 0) {
        setDenied(true);
        setTimeout(() => setDenied(false), 480);
      }
    }, 130);
    return () => clearInterval(id);
  }, []);
  return (
    <div className={`vault-fight ${denied ? 'denied' : ''}`}>
      <div className="vault-readout">{denied ? 'DENIED' : readout}</div>
      <div className="vault-sublabel">
        Temporal retry — attempt <strong>{props.attempt ?? '…'}</strong>
      </div>
      <div className="vault-keypad">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className="vkey" style={{ animationDelay: `${(i % 5) * 0.11}s` }} />
        ))}
      </div>
      <div className="vault-sparks" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <i key={i} style={{ left: `${8 + i * 16}%`, animationDelay: `${i * 0.18}s` }} />
        ))}
      </div>
    </div>
  );
}

// Vault doors slide open on mount, revealing the hold ring inside.
function VaultReveal(props: { children: ReactNode }) {
  return (
    <div className="vault-reveal">
      <div className="vault-granted">✓ ACCESS GRANTED</div>
      <div className="rdoor left" />
      <div className="rdoor right" />
      <div className="vault-inner">{props.children}</div>
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

function EndScreen(props: { won: boolean; onReplay: () => void; onBackToHub: () => void }) {
  return (
    <div className={`overlay ${props.won ? 'won' : 'lost'}`}>
      {props.won && (
        <div className="vault" aria-hidden>
          <div className="vault-door left" />
          <div className="vault-door right" />
        </div>
      )}
      <h2>{props.won ? '🦇 THE BAT-FAMILY ESCAPES' : '☠️ THE VILLAIN WINS'}</h2>
      <p className="muted">
        {props.won ? 'All three chambers cleared before the clock.' : 'The trap sprang before you got out.'}
      </p>
      <div className="endscreen-actions">
        <button className="primary" onClick={props.onReplay}>
          {props.won ? 'Play again' : 'Try again'}
        </button>
        <button className="ghost" onClick={props.onBackToHub}>Back to Bat-computer</button>
      </div>
      <p className="muted small">Re-lighting the signal launches a fresh adventure run — the score carries over.</p>
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
