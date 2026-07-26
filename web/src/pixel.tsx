import type { CSSProperties } from 'react';

// --- Reusable pixel-sprite renderer ---
// Sprites are authored as an array of equal-ish-length strings; each char maps to a
// palette color. Any char not in the palette (e.g. '.' or ' ') is transparent.
// Rendered as 1x1 SVG <rect>s with crisp edges, so it scales to any size without blur.
export function PixelSprite(props: {
  rows: string[];
  palette: Record<string, string>;
  size?: number; // width in px; height derived from aspect ratio
  className?: string;
  style?: CSSProperties;
}) {
  const { rows, palette, size = 96, className, style } = props;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const rects: JSX.Element[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = palette[row[x]];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={fill} />);
    }
  });
  return (
    <svg
      className={className}
      style={style}
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      shapeRendering="crispEdges"
      preserveAspectRatio="xMidYMid meet"
    >
      {rects}
    </svg>
  );
}

// --- The Riddler ---
export type RiddlerMood = 'idle' | 'cackle' | 'scowl' | 'defeat' | 'gloat';

const RIDDLER_PALETTE: Record<string, string> = {
  k: '#0a0f0a', // outline
  g: '#2fbf4a', // riddler green
  d: '#166b28', // dark green (hat band / mask / shadow)
  s: '#e6b088', // skin
  w: '#f4fff4', // white (eyes / ?)
};

// 16 wide. Base bust: bowler hat, domino mask, grin, green suit with a ? on the chest.
const BASE: string[] = [
  '......kkkk......', // 0  hat dome top
  '.....kggggk.....', // 1  dome
  '.....kggggk.....', // 2  dome
  '....kddddddk....', // 3  hat band
  '...kkddddddkk...', // 4  brim
  '.....ssssss.....', // 5  forehead
  '.....dwddwd.....', // 6  mask + eyes
  '.....ssssss.....', // 7  cheeks
  '.....sskkss.....', // 8  mouth (idle grin)
  '......ssss......', // 9  chin
  '....gggggggg....', // 10 shoulders
  '....ggwwwwgg....', // 11 ? top bar
  '....gggggwgg....', // 12 ? upper-right
  '....ggggwggg....', // 13 ? curve
  '....ggggwggg....', // 14 ? stem
  '....gggggggg....', // 15 (gap)
  '....ggggwggg....', // 16 ? dot
  '....gggggggg....', // 17 base
];

function riddlerRows(mood: RiddlerMood): string[] {
  const r = [...BASE];
  if (mood === 'cackle') {
    r[7] = '.....ssssss.....';
    r[8] = '.....kkkkkk.....'; // mouth wide open, laughing
    r[9] = '......kwwk......'; // teeth
  } else if (mood === 'scowl') {
    r[6] = '.....dkddkd.....'; // narrowed eyes
    r[8] = '.....skkks......'; // flat frown-ish
  } else if (mood === 'gloat') {
    r[8] = '.....kwwwwk.....'; // big toothy grin
  }
  return r;
}

export function Riddler(props: { mood?: RiddlerMood; size?: number; className?: string }) {
  const mood = props.mood ?? 'idle';
  return (
    <div className={`riddler mood-${mood} ${props.className ?? ''}`}>
      <PixelSprite rows={riddlerRows(mood)} palette={RIDDLER_PALETTE} size={props.size ?? 96} className="riddler-svg" />
    </div>
  );
}

// --- Bat-Family role avatars (12x11 heads) ---
type Sprite = { rows: string[]; palette: Record<string, string> };
const SKIN = '#e6b088';

const AVATARS: Record<'batman' | 'robin' | 'nightwing' | 'oracle', Sprite> = {
  batman: {
    palette: { k: '#0b0b0d', w: '#cfe6ff', s: SKIN },
    rows: [
      '.k........k.',
      '.kk......kk.',
      'kkkkkkkkkkkk',
      'kkkkkkkkkkkk',
      'kkwwkkkkwwkk',
      'kkkkkkkkkkkk',
      '.kssssssssk.',
      '..ssssssss..',
      '..sskkkkss..',
      '...ssssss...',
      '....ssss....',
    ],
  },
  robin: {
    palette: { h: '#241a0e', a: '#e23b3b', w: '#ffffff', s: SKIN },
    rows: [
      '...hhhhhh...',
      '..hhhhhhhh..',
      '.hhhhhhhhhh.',
      '.ssssssssss.',
      '.aawwaawwaa.',
      '.aaaaaaaaaa.',
      '..ssssssss..',
      '..ssssssss..',
      '...ssssss...',
      '....ssss....',
      '............',
    ],
  },
  nightwing: {
    palette: { h: '#111119', k: '#0a0a0a', a: '#5566ff', w: '#dfe8ff', s: SKIN },
    rows: [
      '..hhhhhhhh..',
      '.hhhhhhhhhh.',
      '.hhhhhhhhhh.',
      '.ssssssssss.',
      '.kkwwkkwwkk.',
      '.aakkkkkkaa.',
      '..ssssssss..',
      '..ssssssss..',
      '...ssssss...',
      '....ssss....',
      '............',
    ],
  },
  oracle: {
    palette: { h: '#d24a2a', a: '#2fbf4a', w: '#ffffff', s: SKIN, k: '#0a0a0a' },
    rows: [
      '..hhhhhhhh..',
      '.hhhhhhhhhh.',
      'hhhhhhhhhhhh',
      'ahssssssssha',
      'ahswwsswwsha',
      'ahssssssssha',
      '.hssssssssh.',
      '..ssssssss..',
      '...ssssss...',
      '....ssss....',
      '............',
    ],
  },
};

export function RoleAvatar(props: { role: 'batman' | 'robin' | 'nightwing' | 'oracle'; size?: number; className?: string }) {
  const s = AVATARS[props.role];
  return <PixelSprite rows={s.rows} palette={s.palette} size={props.size ?? 44} className={props.className} />;
}

// Your chosen hero as a caped bust: the approved head avatar + a role-colored body/emblem.
// 'c' = cape/suit, 'e' = emblem.
type HeroRole = 'batman' | 'robin' | 'nightwing' | 'oracle';
const HERO_BODY: Record<HeroRole, { c: string; e: string }> = {
  batman: { c: '#23262b', e: '#f5c518' },
  robin: { c: '#d1354a', e: '#f5c518' },
  nightwing: { c: '#14161f', e: '#5566ff' },
  oracle: { c: '#2a2f3a', e: '#2fbf4a' },
};
const BODY_ROWS: string[] = [
  '.....cc.cc.....',
  '..cccccccccc..',
  '.cccccccccccc.',
  '.cccceeeecccc.',
  '.cccceeeecccc.',
  '.cccccccccccc.',
  '.cccccccccccc.',
];

export type HeroMood = 'idle' | 'cheer' | 'flinch' | 'defeat';

export function HeroMascot(props: { role: HeroRole; mood?: HeroMood; size?: number; className?: string }) {
  const mood = props.mood ?? 'idle';
  const head = AVATARS[props.role];
  const body = HERO_BODY[props.role];
  // pad head rows (12 wide) to the 14-wide body and stack.
  const headRows = head.rows.map((r) => `.${r}.`);
  const rows = [...headRows, ...BODY_ROWS];
  const palette = { ...head.palette, c: body.c, e: body.e };
  return (
    <div className={`hero-mascot hmood-${mood} ${props.className ?? ''}`}>
      <PixelSprite rows={rows} palette={palette} size={props.size ?? 112} className="hero-mascot-svg" />
    </div>
  );
}

// --- Bat-Signal emblem (the classic sweptwing bat, projected in the light) ---
// Rasterized from the classic Batman-logo ASCII, mirrored around center for symmetry.
const BAT_EMBLEM_ROWS: string[] = [
  '.......kkkk..........k.....k..........kkkk.......',
  '.....kkkk............kkkkkkk............kkkk.....',
  '...kkkkkk............kkkkkkk............kkkkkk...',
  '..kkkkkkkkk.........kkkkkkkkk.........kkkkkkkkk..',
  '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk',
  '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.',
  '..kkkkk.......kkkkkkkkkkkkkkkkkkkkk.......kkkkk..',
  '....kkkk.......kkk....kkkkk....kkk.......kkkk....',
  '.......kk.......k......kkk......k.......kk.......',
];
export function BatEmblem(props: { color?: string; size?: number; className?: string }) {
  return (
    <PixelSprite
      rows={BAT_EMBLEM_ROWS}
      palette={{ k: props.color ?? '#0a0a0a' }}
      size={props.size ?? 120}
      className={props.className}
    />
  );
}

// --- Bats (victory scatter) ---
const BAT: Sprite = {
  palette: { k: '#0a0a0a' },
  rows: ['k......k', 'kk....kk', 'kkk..kkk', '.kkkkkk.', '..k..k..'],
};

export function VictoryBats() {
  const bats = Array.from({ length: 16 });
  return (
    <div className="layer bats" aria-hidden>
      {bats.map((_, i) => {
        const style: CSSProperties = {
          left: `${(i * 53) % 100}%`,
          animationDuration: `${1.6 + (i % 5) * 0.4}s`,
          animationDelay: `${(i % 6) * 0.12}s`,
        };
        return (
          <span key={i} className="bat" style={style}>
            <PixelSprite rows={BAT.rows} palette={BAT.palette} size={26 + (i % 3) * 10} />
          </span>
        );
      })}
    </div>
  );
}
