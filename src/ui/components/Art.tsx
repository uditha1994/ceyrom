/** Brand mark, avatar emblems and decorative motifs. */
import { CSSProperties } from 'react';

export function Mark({ size = 56, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className={spin ? 'mark spin' : 'mark'}>
      <g transform="rotate(45 32 32)">
        <rect x="11" y="11" width="42" height="42" rx="5" fill="var(--wood)" stroke="var(--brass)" strokeWidth="2" />
        <rect x="16" y="16" width="32" height="32" rx="2" fill="var(--ivory)" />
        {[
          [19.5, 19.5],
          [44.5, 19.5],
          [19.5, 44.5],
          [44.5, 44.5],
        ].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="2.6" fill="var(--ebony)" />
        ))}
      </g>
      <g className="mark-lotus">
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} d="M32 31 C34.5 27 34 24 32 21.5 C30 24 29.5 27 32 31Z" fill="var(--queen)" transform={`rotate(${i * 45} 32 32)`} opacity={0.9} />
        ))}
        <circle cx="32" cy="32" r="3" fill="var(--brass)" />
      </g>
    </svg>
  );
}

export function Wordmark({ size = 44 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size } as CSSProperties}>
      Ceyrom
    </span>
  );
}

/** Pala peththa (lotus petal) border strip — used as a divider. */
export function PetalRule({ className = '' }: { className?: string }) {
  return (
    <svg className={`petal-rule ${className}`} viewBox="0 0 240 14" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        <pattern id="petal" width="16" height="14" patternUnits="userSpaceOnUse">
          <path d="M8 13 C3 9 3 4 8 1 C13 4 13 9 8 13Z" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="0" cy="7" r="1.1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="240" height="14" fill="url(#petal)" />
    </svg>
  );
}

const AV_BG = ['#6F4535', '#66705A', '#30251E', '#8E2F25', '#7A5230', '#4F5A4A', '#5C3B2E', '#3E3229'];

const emblems: ((c: string) => JSX.Element)[] = [
  // 0 lotus
  (c) => (
    <g fill={c}>
      {Array.from({ length: 7 }, (_, i) => (
        <path key={i} d="M32 40 C38 32 37 24 32 16 C27 24 26 32 32 40Z" transform={`rotate(${-54 + i * 18} 32 44)`} opacity={i % 2 ? 0.75 : 1} />
      ))}
      <path d="M18 46 h28" stroke={c} strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  // 1 sun (Ira)
  (c) => (
    <g stroke={c} strokeWidth="2.6" strokeLinecap="round" fill="none">
      <circle cx="32" cy="32" r="8" fill={c} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <path key={i} d={`M${32 + Math.cos(a) * 13} ${32 + Math.sin(a) * 13} L${32 + Math.cos(a) * (i % 2 ? 18 : 21)} ${32 + Math.sin(a) * (i % 2 ? 18 : 21)}`} />;
      })}
    </g>
  ),
  // 2 moon (Handa)
  (c) => (
    <g fill={c}>
      <path d="M38 14 A18 18 0 1 0 50 40 A14 14 0 1 1 38 14Z" />
      <circle cx="44" cy="20" r="1.8" />
      <circle cx="49" cy="28" r="1.2" />
    </g>
  ),
  // 3 gem (Ratnapura)
  (c) => (
    <g stroke={c} strokeWidth="2.2" strokeLinejoin="round" fill="none">
      <path d="M20 26 L26 17 H38 L44 26 L32 48 Z" fill={c} fillOpacity={0.25} />
      <path d="M20 26 H44 M26 17 L30 26 L32 48 L34 26 L38 17" />
    </g>
  ),
  // 4 leaf (Bo leaf)
  (c) => (
    <g fill={c}>
      <path d="M32 12 C44 20 48 34 32 50 C16 34 20 20 32 12Z" />
      <path d="M32 50 C32 56 34 58 37 59" stroke={c} strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M32 18 V46 M32 28 L25 24 M32 28 L39 24 M32 36 L24 31 M32 36 L40 31" stroke="var(--av-bg, #30251E)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    </g>
  ),
  // 5 wave (Muhuda)
  (c) => (
    <g stroke={c} strokeWidth="2.8" strokeLinecap="round" fill="none">
      <path d="M12 26 C18 20 24 20 28 26 C32 32 38 32 44 26 C48 22 52 22 54 24" />
      <path d="M12 36 C18 30 24 30 28 36 C32 42 38 42 44 36 C48 32 52 32 54 34" opacity={0.7} />
      <path d="M12 46 C18 40 24 40 28 46 C32 52 38 52 44 46" opacity={0.45} />
    </g>
  ),
  // 6 drum (Geta bera)
  (c) => (
    <g stroke={c} strokeWidth="2.2" fill="none" strokeLinejoin="round">
      <path d="M18 22 C24 26 40 26 46 22 L42 44 C36 48 28 48 22 44 Z" fill={c} fillOpacity={0.25} />
      <ellipse cx="32" cy="22" rx="14" ry="4" fill={c} />
      <path d="M20 26 L26 44 M32 27 V47 M44 26 L38 44" />
    </g>
  ),
  // 7 peacock eye (Monara)
  (c) => (
    <g>
      <path d="M32 10 C46 22 48 38 32 52 C16 38 18 22 32 10Z" fill={c} opacity={0.35} />
      <path d="M32 20 C40 28 41 37 32 46 C23 37 24 28 32 20Z" fill={c} />
      <circle cx="32" cy="34" r="5" fill="var(--av-bg, #30251E)" />
    </g>
  ),
];

export const AVATAR_COUNT = emblems.length;

export function Avatar({ id, size = 48, ring }: { id: number; size?: number; ring?: string }) {
  const bg = AV_BG[id % AV_BG.length];
  const fg = id % 4 === 2 ? '#C6A878' : '#E8D9BC';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="avatar" style={{ '--av-bg': bg } as CSSProperties} aria-hidden>
      <circle cx="32" cy="32" r="31" fill={bg} stroke={ring ?? 'rgba(198,168,120,.55)'} strokeWidth={ring ? 3 : 1.5} />
      <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(232,217,188,.14)" strokeDasharray="2 3" />
      {emblems[id % emblems.length](fg)}
    </svg>
  );
}

/** Small coin glyph for HUD counters. */
export function CoinDot({ kind, size = 14 }: { kind: 'white' | 'black' | 'queen'; size?: number }) {
  const fill = kind === 'white' ? '#EEDFC2' : kind === 'black' ? '#2E241E' : '#A33326';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="coin-dot">
      <circle cx="8" cy="8" r="7" fill={fill} stroke="rgba(198,168,120,.8)" strokeWidth="1" />
      <circle cx="8" cy="8" r="4.2" fill="none" stroke={kind === 'black' ? 'rgba(255,230,200,.25)' : 'rgba(80,50,20,.35)'} strokeWidth=".8" />
    </svg>
  );
}
