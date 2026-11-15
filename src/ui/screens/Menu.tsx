import { useTranslation } from 'react-i18next';
import { fmtNumber } from '../../i18n';
import { loadAiPrefs, makeAiSession, makeSolo } from '../../game/sessions';
import { todayKey } from '../../game/drills';
import { levelFor, useApp, useProfile } from '../../store/stores';
import { Avatar, Mark, PetalRule, Wordmark } from '../components/Art';
import { IconBook, IconBot, IconCalendar, IconGear, IconGlobe, IconPeople, IconPlay, IconTarget, IconTrophy } from '../components/Icons';
import { Button, Screen, TopBar } from '../components/Kit';
import { LiveTable } from '../components/LiveTable';

export function MainMenu() {
  const { t } = useTranslation();
  const go = useApp((s) => s.go);
  const start = useApp((s) => s.startSession);
  const p = useProfile();
  const prefs = loadAiPrefs();
  const doneToday = p.daily[todayKey()] !== undefined;
  const quick = () => start(makeAiSession(prefs));

  return (
    <Screen className="menu" id="screen-menu">
      <header className="menu-top">
        <button type="button" className="profile-chip" onClick={() => go('profile')}>
          <Avatar id={p.avatar} size={40} />
          <span className="chip-text">
            <strong>{p.name || t('onboard.defaultName')}</strong>
            <small>
              {t('profile.level', { n: fmtNumber(levelFor(p.xp)) })} · {fmtNumber(p.rating)}
            </small>
          </span>
        </button>
        <div className="row tight">
          <Button variant="ghost" icon={<IconTrophy />} label={t('menu.leaderboard')} onClick={() => go('leaderboard')} />
          <Button variant="ghost" icon={<IconGear />} label={t('menu.settings')} onClick={() => go('settings')} />
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="hero-brand">
            <Mark size={60} />
            <Wordmark size={72} />
          </div>
          <p className="hero-tag">{t('brand.tagline')}</p>
          <div className="hero-actions">
            <Button size="lg" icon={<IconPlay />} onClick={() => go('mode')} id="btn-play">
              {t('menu.play')}
            </Button>
            <Button size="lg" variant="secondary" icon={<IconBot />} onClick={quick} id="btn-quick">
              {t('menu.quick', { level: t(`ai.level.${prefs.difficulty}`) })}
            </Button>
          </div>
        </div>
        <LiveTable onSit={quick} />
      </section>

      <PetalRule />

      <nav className="menu-grid" aria-label={t('menu.more')}>
        <MenuTile icon={<IconBot size={26} />} title={t('mode.ai.title')} sub={t('mode.ai.sub')} onClick={() => go('aiSetup')} />
        <MenuTile icon={<IconGlobe size={26} />} title={t('mode.online.title')} sub={t('mode.online.sub')} onClick={() => go('lobby')} />
        <MenuTile icon={<IconPeople size={26} />} title={t('mode.local.title')} sub={t('mode.local.sub')} onClick={() => go('localSetup')} />
        <MenuTile icon={<IconTarget size={26} />} title={t('mode.practice.title')} sub={t('mode.practice.sub')} onClick={() => go('practice')} />
        <MenuTile icon={<IconBook size={26} />} title={t('menu.tutorial')} sub={t('menu.tutorialSub')} onClick={() => start(makeSolo('tutorial'))} />
        <MenuTile
          icon={<IconCalendar size={26} />}
          title={t('menu.daily')}
          sub={doneToday ? t('menu.dailyDone', { n: p.daily[todayKey()] }) : t('menu.dailySub')}
          onClick={() => start(makeSolo('challenge'))}
        />
      </nav>
    </Screen>
  );
}

function MenuTile({ icon, title, sub, onClick }: { icon: JSX.Element; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className="tile" onClick={onClick}>
      <span className="tile-icon">{icon}</span>
      <span className="tile-text">
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );
}

/** Mode select laid out as a carrom board: four modes in the quarters, the queen starts a quick game. */
export function ModeSelect() {
  const { t } = useTranslation();
  const go = useApp((s) => s.go);
  const start = useApp((s) => s.startSession);
  const prefs = loadAiPrefs();
  const modes = [
    { id: 'aiSetup' as const, icon: <IconBot size={30} />, title: t('mode.ai.title'), sub: t('mode.ai.sub') },
    { id: 'lobby' as const, icon: <IconGlobe size={30} />, title: t('mode.online.title'), sub: t('mode.online.sub') },
    { id: 'localSetup' as const, icon: <IconPeople size={30} />, title: t('mode.local.title'), sub: t('mode.local.sub') },
    { id: 'practice' as const, icon: <IconTarget size={30} />, title: t('mode.practice.title'), sub: t('mode.practice.sub') },
  ];
  return (
    <Screen id="screen-mode">
      <TopBar title={t('mode.title')} />
      <div className="mode-board">
        <div className="mode-surface">
          <svg className="mode-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <circle cx="50" cy="50" r="13" />
            <circle cx="50" cy="50" r="14.2" />
          </svg>
          {['tl', 'tr', 'bl', 'br'].map((c) => (
            <span key={c} className={`mode-pocket ${c}`} aria-hidden />
          ))}
          <div className="mode-quads">
            {modes.map((m) => (
              <button key={m.id} type="button" className="mode-quad" onClick={() => go(m.id)}>
                <span className="mode-icon">{m.icon}</span>
                <strong>{m.title}</strong>
                <small>{m.sub}</small>
              </button>
            ))}
          </div>
          <button type="button" className="mode-queen" onClick={() => start(makeAiSession(prefs))} aria-label={t('menu.quick', { level: t(`ai.level.${prefs.difficulty}`) })} id="btn-queen">
            <IconPlay size={30} />
          </button>
        </div>
      </div>
      <p className="mode-hint muted">{t('mode.hint', { level: t(`ai.level.${prefs.difficulty}`) })}</p>
    </Screen>
  );
}
