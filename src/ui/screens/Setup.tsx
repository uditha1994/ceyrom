import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIFFICULTIES, Difficulty } from '../../core/ai';
import { PRESETS, PresetId, RuleConfig } from '../../core/rules';
import { DRILLS } from '../../game/drills';
import { AiPrefs, loadAiPrefs, makeAiSession, makeLocalSession, makeSolo, saveAiPrefs } from '../../game/sessions';
import { load, save } from '../../store/storage';
import { useApp, useProfile } from '../../store/stores';
import { Avatar } from '../components/Art';
import { IconPlay } from '../components/Icons';
import { Button, Field, Screen, Segmented, Toggle, TopBar } from '../components/Kit';

export const PRESET_IDS: PresetId[] = ['casual', 'competitive', 'gedara', 'freestyle'];

export function RulesPicker({ value, onChange, allowCustom }: { value: RuleConfig; onChange: (r: RuleConfig) => void; allowCustom?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="rules-picker">
      <div className="preset-list" role="radiogroup" aria-label={t('rules.title')}>
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value.preset === id}
            className={`preset${value.preset === id ? ' on' : ''}`}
            onClick={() => onChange({ ...PRESETS[id], shotClock: value.shotClock })}
          >
            <strong>{t(`rules.preset.${id}`)}</strong>
            <small>{t(`rules.presetHint.${id}`)}</small>
          </button>
        ))}
      </div>
      {allowCustom && value.variant === 'standard' && (
        <div className="custom-rules">
          <Toggle id="rule-queen" checked={value.queenNeedsOwnCoin} label={t('rules.queenNeedsOwn')} onChange={(v) => onChange({ ...value, preset: 'custom', queenNeedsOwnCoin: v })} />
          <Toggle id="rule-penalty" checked={value.strikerPenalty} label={t('rules.strikerPenalty')} onChange={(v) => onChange({ ...value, preset: 'custom', strikerPenalty: v })} />
          <Field label={t('rules.target')}>
            <Segmented
              id="rule-target"
              label={t('rules.target')}
              value={value.targetPoints}
              onChange={(v) => onChange({ ...value, preset: 'custom', targetPoints: v })}
              options={[
                { value: 0, label: t('rules.oneBoard') },
                { value: 13, label: '13' },
                { value: 25, label: '25' },
              ]}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

export function AiSetup() {
  const { t } = useTranslation();
  const start = useApp((s) => s.startSession);
  const [prefs, setPrefs] = useState<AiPrefs>(loadAiPrefs());
  const [rules, setRules] = useState<RuleConfig>({ ...PRESETS[prefs.preset] });
  const set = (p: Partial<AiPrefs>) => setPrefs((x) => ({ ...x, ...p }));
  const go = () => {
    const pr = { ...prefs, preset: (rules.preset === 'custom' ? 'casual' : rules.preset) as PresetId };
    saveAiPrefs(pr);
    start(makeAiSession(pr));
  };
  return (
    <Screen id="screen-ai">
      <TopBar title={t('ai.title')} />
      <div className="setup">
        <Field label={t('ai.difficulty')}>
          <div className="diff-list" role="radiogroup" aria-label={t('ai.difficulty')}>
            {DIFFICULTIES.map((d, i) => (
              <button key={d} type="button" role="radio" aria-checked={prefs.difficulty === d} className={`diff${prefs.difficulty === d ? ' on' : ''}`} onClick={() => set({ difficulty: d })}>
                <span className="pips" aria-hidden>
                  {DIFFICULTIES.map((_, k) => (
                    <i key={k} className={k <= i ? 'on' : ''} />
                  ))}
                </span>
                <strong>{t(`ai.level.${d}`)}</strong>
                <small>{t(`ai.desc.${d}`)}</small>
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('ai.players')}>
          <Segmented
            id="ai-seats"
            label={t('ai.players')}
            value={prefs.seats}
            onChange={(v) => set({ seats: v })}
            options={[
              { value: 2, label: t('ai.oneVsOne') },
              { value: 4, label: t('ai.twoVsTwo') },
            ]}
          />
        </Field>
        <Field label={t('rules.title')}>
          <RulesPicker value={rules} onChange={(r) => (setRules(r), r.preset !== 'custom' && set({ preset: r.preset as PresetId }))} />
        </Field>
        <Toggle id="ai-clock" checked={prefs.clock} label={t('rules.shotClock')} hint={t('rules.shotClockHint')} onChange={(v) => set({ clock: v })} />
        <Button size="lg" wide icon={<IconPlay />} onClick={go} id="btn-start-ai">
          {t('ai.start')}
        </Button>
      </div>
    </Screen>
  );
}

export function LocalSetup() {
  const { t } = useTranslation();
  const start = useApp((s) => s.startSession);
  const me = useProfile((s) => s.name);
  const saved = load('ceyrom.localNames', { names: [me || 'Player 1', 'Player 2', 'Player 3', 'Player 4'], seats: 2 as 2 | 4, preset: 'gedara' as PresetId, clock: false });
  const [names, setNames] = useState<string[]>(saved.names);
  const [seats, setSeats] = useState<2 | 4>(saved.seats);
  const [rules, setRules] = useState<RuleConfig>({ ...PRESETS[saved.preset] });
  const [clock, setClock] = useState(saved.clock);
  const go = () => {
    const preset = (rules.preset === 'custom' ? 'casual' : rules.preset) as PresetId;
    const clean = names.map((n, i) => n.trim().slice(0, 16) || t('local.player', { n: i + 1 }));
    save('ceyrom.localNames', { names: clean, seats, preset, clock });
    start(makeLocalSession(clean, seats, preset, clock));
  };
  const teamLabel = (i: number) => (seats === 4 ? t('local.team', { n: (i % 2) + 1 }) : '');
  return (
    <Screen id="screen-local">
      <TopBar title={t('local.title')} />
      <div className="setup">
        <p className="muted">{t('local.hint')}</p>
        <Field label={t('ai.players')}>
          <Segmented
            id="local-seats"
            label={t('ai.players')}
            value={seats}
            onChange={setSeats}
            options={[
              { value: 2, label: t('local.two') },
              { value: 4, label: t('local.four') },
            ]}
          />
        </Field>
        <div className="names">
          {Array.from({ length: seats }, (_, i) => (
            <label key={i} className="name-row" htmlFor={`local-name-${i}`}>
              <Avatar id={(i * 3 + 1) % 8} size={36} />
              <input id={`local-name-${i}`} className="input" value={names[i] ?? ''} maxLength={16} onChange={(e) => setNames((n) => n.map((x, k) => (k === i ? e.target.value : x)))} placeholder={t('local.player', { n: i + 1 })} />
              {teamLabel(i) && <span className="badge">{teamLabel(i)}</span>}
            </label>
          ))}
        </div>
        <Field label={t('rules.title')}>
          <RulesPicker value={rules} onChange={setRules} />
        </Field>
        <Toggle id="local-clock" checked={clock} label={t('rules.shotClock')} hint={t('rules.shotClockHint')} onChange={setClock} />
        <Button size="lg" wide icon={<IconPlay />} onClick={go} id="btn-start-local">
          {t('local.start')}
        </Button>
      </div>
    </Screen>
  );
}

export function PracticeMenu() {
  const { t } = useTranslation();
  const start = useApp((s) => s.startSession);
  return (
    <Screen id="screen-practice">
      <TopBar title={t('practice.title')} />
      <div className="setup">
        <p className="muted">{t('practice.hint')}</p>
        <div className="drill-grid">
          {DRILLS.map((d) => (
            <button key={d} type="button" className="drill" onClick={() => start(makeSolo('practice', d))}>
              <DrillArt id={d} />
              <strong>{t(`drill.${d}.title`)}</strong>
              <small>{t(`drill.${d}.sub`)}</small>
            </button>
          ))}
        </div>
      </div>
    </Screen>
  );
}

function DrillArt({ id }: { id: string }) {
  const coin = (x: number, y: number, k: 'w' | 'b' | 'q') => <circle cx={x} cy={y} r="4.2" fill={k === 'w' ? '#EEDFC2' : k === 'b' ? '#2E241E' : '#A33326'} stroke="var(--brass)" strokeWidth=".6" />;
  const lines: Record<string, JSX.Element> = {
    break: (
      <>
        {[0, 1, 2, 3, 4, 5].map((i) => coin(40 + Math.cos((i * Math.PI) / 3) * 9, 30 + Math.sin((i * Math.PI) / 3) * 9, i % 2 ? 'b' : 'w'))}
        {coin(40, 30, 'q')}
      </>
    ),
    straight: (
      <>
        <path d="M58 50 L22 12" stroke="var(--brass)" strokeDasharray="3 2" />
        {coin(32, 22, 'w')}
      </>
    ),
    cut: (
      <>
        <path d="M50 52 L26 26 L10 14" stroke="var(--brass)" strokeDasharray="3 2" fill="none" />
        {coin(22, 22, 'w')}
      </>
    ),
    rebound: (
      <>
        <path d="M48 50 L30 8 L14 46" stroke="var(--brass)" strokeDasharray="3 2" fill="none" />
        {coin(14, 50, 'w')}
      </>
    ),
    queen: (
      <>
        {coin(40, 30, 'q')}
        {coin(24, 18, 'w')}
        {coin(56, 20, 'w')}
      </>
    ),
    cluster: (
      <>
        {coin(48, 18, 'w')}
        {coin(56.5, 18, 'w')}
        {coin(52, 11, 'b')}
        {coin(48, 26.5, 'b')}
      </>
    ),
  };
  return (
    <svg viewBox="0 0 80 60" width="80" height="60" aria-hidden className="drill-art">
      <rect x="2" y="2" width="76" height="56" rx="4" fill="var(--board-surface)" stroke="var(--wood)" strokeWidth="3" />
      {[
        [6, 6],
        [74, 6],
        [6, 54],
        [74, 54],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#140c08" />
      ))}
      {lines[id]}
    </svg>
  );
}

export type { Difficulty };
