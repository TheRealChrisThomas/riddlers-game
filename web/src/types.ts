// The wire protocol is not duplicated here — it comes straight from the server's
// definition in src/protocol.ts, so a shape change is a compile error on both
// sides instead of a silent drift. Only client-side things belong in this file.
export * from '../../src/protocol';

import type { Role } from '../../src/protocol';

// The vow the answering hero throws back at the villain when the Bat-Signal
// fires. `{villain}` is replaced with the villain's callsign (e.g. "Riddler").
export const HERO_VOW: Record<Role, string> = {
  batman: "You won't get away this time, {villain}.",
  robin: "Not tonight, {villain}. Not on my watch.",
  nightwing: "Same old {villain}. Same ending — you, in a cell.",
  oracle: "I see every move you make, {villain}. Every single one.",
};
