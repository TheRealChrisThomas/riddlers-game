import type { CSSProperties } from 'react';

// Pure-CSS ambient layer: drifting question marks + a slow bat-signal glow behind
// everything, and a subtle CRT scanline/flicker overlay on top. Purely decorative.
export function Ambient() {
  const marks = Array.from({ length: 16 });
  return (
    <>
      <div className="ambient-bg" aria-hidden>
        <div className="bat-glow" />
        <div className="qmarks">
          {marks.map((_, i) => {
            const style: CSSProperties = {
              left: `${(i * 61) % 100}%`,
              animationDuration: `${16 + (i % 6) * 5}s`,
              animationDelay: `${-(i * 3.1) % 24}s`,
              fontSize: `${18 + (i % 4) * 14}px`,
              opacity: 0.03 + (i % 3) * 0.025,
            };
            return (
              <span key={i} style={style}>
                ?
              </span>
            );
          })}
        </div>
      </div>
      <div className="crt-overlay" aria-hidden />
    </>
  );
}
