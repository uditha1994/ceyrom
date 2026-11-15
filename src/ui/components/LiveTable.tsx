/** The main menu's live table: a real AI-vs-AI game seen from a seat at the table. */
import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DemoStatus, DemoTable } from '../../game/demo';
import { fmtNumber } from '../../i18n';
import { prefersReducedMotion, useSettings } from '../../store/stores';
import { CoinDot } from './Art';

export function LiveTable({ onSit }: { onSit: () => void }) {
  const { t } = useTranslation();
  const board = useSettings((s) => s.board);
  const striker = useSettings((s) => s.striker);
  const saver = useSettings((s) => s.quality === 'low' || s.lowData);
  const motion = useSettings((s) => s.motion);
  const frame = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLCanvasElement>(null);
  const fg = useRef<HTMLCanvasElement>(null);
  const table = useRef<DemoTable | null>(null);
  const [size, setSize] = useState(0);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  // battery saver and reduced motion show the opening rack, standing still
  const still = saver || prefersReducedMotion();

  useEffect(() => {
    const d = new DemoTable(fg.current!, bg.current!, { theme: board, striker, reducedMotion: prefersReducedMotion() }, setStatus, !still);
    table.current = d;
    const fit = () => {
      // leave room around the board: the tilt widens its near edge
      const w = Math.floor(Math.min(frame.current!.getBoundingClientRect().width * 0.8, 390));
      if (w > 0) {
        d.resize(w);
        setSize(w);
      }
    };
    const ro = new ResizeObserver(fit);
    ro.observe(frame.current!);
    fit();
    d.start();
    return () => {
      ro.disconnect();
      d.destroy();
      table.current = null;
    };
    // a new table when the look or motion preference changes
  }, [board, striker, still, motion]);

  const names = [t('menu.liveA'), t('menu.liveB')];
  return (
    <figure className="live" ref={frame} style={{ '--live-size': `${size}px` } as CSSProperties}>
      <button type="button" className={`live-stage${still ? ' still' : ''}`} onClick={onSit} aria-label={t('menu.takeSeat')} title={t('menu.takeSeat')}>
        <span className="live-tilt">
          <canvas ref={bg} className="board-bg" aria-hidden />
          <canvas ref={fg} className="live-canvas" aria-hidden />
        </span>
      </button>
      <figcaption className="live-caption">
        <span className="live-label">
          {!still && <i className="live-dot" aria-hidden />}
          {t('menu.live')}
        </span>
        {status &&
          [0, 1].map((seat) => (
            <span key={seat} className={`live-player${!still && status.turn === seat ? ' on' : ''}`}>
              {names[seat]} <CoinDot kind={status.colors[seat]} size={13} /> {fmtNumber(status.left[seat])}
            </span>
          ))}
      </figcaption>
    </figure>
  );
}
