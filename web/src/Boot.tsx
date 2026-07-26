import { useEffect, useRef, useState } from 'react';

// ============================================================================
// The Bat-computer boot sequence: a CRT terminal types its way through a
// self-check, greets the operator, then waits on [ LET'S BEGIN ]. Pure
// presentation — the hub poll runs behind this, so nothing is being delayed by
// it. Click or press any key to skip the typing.
// ============================================================================

const CHAR_MS = 9; // per character
const LINE_MS = 120; // pause after a line completes
const STATUS_MS = 220; // beat before a check reports back

interface BootLine {
  text: string;
  status?: string; // dot-leader result, revealed a beat after the text
  tone?: 'ok' | 'bat'; // status colour
  cls?: string;
  gap?: number; // override the pause after this line
}

// The dot leaders are padded to a fixed column so the results line up.
const LEADER = 34;
const check = (label: string, status: string, tone: BootLine['tone'] = 'ok'): BootLine => ({
  text: `> ${label} ${'.'.repeat(Math.max(3, LEADER - label.length))}`,
  status,
  tone,
});

const script = (code: string, operator: string): BootLine[] => [
  { text: 'BAT-COMPUTER  //  WAYNE ENTERPRISES', cls: 'boot-title', gap: 240 },
  { text: 'GOTHAM PD LIAISON LINK — CLEARANCE: BAT-FAMILY', cls: 'boot-sub', gap: 420 },
  { text: '' },
  check('CAVE POWER', 'NOMINAL'),
  check('GOTHAM PD SCANNER', 'LIVE'),
  check(`CASE FILE ${code}`, 'OPEN'),
  check(`OPERATOR ${operator.toUpperCase()}`, 'VERIFIED'),
  check('BAT-SIGNAL LAMP', 'ARMED', 'bat'),
  { text: '', gap: 320 },
  { text: `WELCOME TO THE BAT-COMPUTER, ${operator.toUpperCase()}.`, cls: 'boot-welcome' },
];

export function BootTerminal(props: { code: string; operator: string; onDone: () => void }) {
  const lines = script(props.code, props.operator);
  const [pos, setPos] = useState({ line: 0, chars: 0, status: false });
  const [skipped, setSkipped] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const done = skipped || pos.line >= lines.length;

  // A click that skips the typing must not also land on the button it reveals —
  // the click follows its own pointerdown, by which time the button is live. Only
  // that path needs guarding; a keypress at the prompt always counts.
  const skipClickAt = useRef(0);
  const beginByClick = () => {
    if (Date.now() - skipClickAt.current > 250) props.onDone();
  };

  // Drive the typewriter one beat at a time: characters, then the check result,
  // then on to the next line.
  useEffect(() => {
    if (done) return;
    const cur = lines[pos.line];
    if (pos.chars < cur.text.length) {
      const t = setTimeout(() => setPos((p) => ({ ...p, chars: p.chars + 1 })), CHAR_MS);
      return () => clearTimeout(t);
    }
    if (cur.status && !pos.status) {
      const t = setTimeout(() => setPos((p) => ({ ...p, status: true })), STATUS_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPos({ line: pos.line + 1, chars: 0, status: false }), cur.gap ?? LINE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, done]);

  // Any key or click fast-forwards the typing (but never advances past the prompt).
  useEffect(() => {
    if (done) return;
    const skipByKey = () => setSkipped(true);
    const skipByPointer = () => {
      skipClickAt.current = Date.now();
      setSkipped(true);
    };
    window.addEventListener('keydown', skipByKey);
    window.addEventListener('pointerdown', skipByPointer);
    return () => {
      window.removeEventListener('keydown', skipByKey);
      window.removeEventListener('pointerdown', skipByPointer);
    };
  }, [done]);

  // Enter/space at the prompt begins.
  useEffect(() => {
    if (!done) return;
    const go = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') props.onDone();
    };
    window.addEventListener('keydown', go);
    return () => window.removeEventListener('keydown', go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  return (
    <div className="boot" role="group" aria-label="Bat-computer start-up">
      <div className="boot-crt" aria-hidden />
      <div className="boot-screen">
        {/* Every line always occupies its full width — untyped text, the caret and
            pending results are only made invisible, never removed. The screen is
            sized to its own content, so anything else would shift it as it types. */}
        {/* Decorative: it retypes every few ms, which would flood a screen reader.
            The prompt button below is the accessible affordance. */}
        <pre className="boot-out" aria-hidden>
          {lines.map((l, i) => {
            const state = skipped || i < pos.line ? 'full' : i === pos.line ? 'typing' : 'pending';
            const typed = state === 'full' ? l.text : state === 'typing' ? l.text.slice(0, pos.chars) : '';
            const rest = l.text.slice(typed.length);
            const showStatus = state === 'full' || (state === 'typing' && pos.status);
            return (
              <div key={i} className={`boot-line ${l.cls ?? ''}`}>
                {typed}
                <span className={`boot-caret ${state === 'typing' && !done ? '' : 'off'}`} />
                <span className="off">{rest || (l.text === '' ? '\u00a0' : '')}</span>
                {l.status && <span className={`boot-status tone-${l.tone} ${showStatus ? '' : 'off'}`}> {l.status}</span>}
              </div>
            );
          })}
        </pre>

        <div className={`boot-prompt ${done ? 'ready' : ''}`}>
          <button className="boot-begin" onClick={beginByClick} disabled={!done}>
            [ LET'S BEGIN ]
          </button>
          <span className="boot-hint">{done ? 'press enter' : 'click to skip'}</span>
        </div>
      </div>
    </div>
  );
}
