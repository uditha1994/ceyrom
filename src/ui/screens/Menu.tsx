import { useTranslation } from 'react-i18next';
import { fmtNumber } from '../../i18n';
import { loadAiPrefs, makeAiSession, makeSolo } from '../../game/sessions';
import { todayKey } from '../../game/drills';
import { levelFor, useApp, useProfile } from '../../store/stores';
import { Avatar, Mark, PetalRule, Wordmark } from '../components/Art';
import { IconBook, IconBot, IconCalendar, IconGear, IconGlobe, IconPeople, IconPlay, IconTarget, IconTrophy } from '../components/Icons';
import { Button, Screen, TopBar } from '../components/Kit';

export function MainMenu() {
  const { t } = useTranslation();
  const go = useApp((s) => s.go);
  const start = useApp((s) => s.startSession);
  const p = useProfile();
  const prefs = loadAiPrefs();
  const doneToday = p.daily[todayKey()] !== undefined;

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
        <Mark size={72} />
        <Wordmark size={72} />
        <p className="hero-tag">{t('brand.tagline')}</p>
        <div className="hero-actions">
          <Button size="lg" icon={<IconPlay />} onClick={() => go('mode')} id="btn-play">
            {t('menu.play')}
          </Button>
          <Button size="lg" variant="secondary" icon={<IconBot />} onClick={() => start(makeAiSession(prefs))} id="btn-quick">
            {t('menu.quick', { level: t(`ai.level.${prefs.difficulty}`) })}
          </Button>
        </div>
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

export function ModeSelect() {
  const { t } = useTranslation();
  const go = useApp((s) => s.go);
  const modes = [
    { id: 'aiSetup' as const, icon: <IconBot size={34} />, title: t('mode.ai.title'), sub: t('mode.ai.long'), tag: t('mode.single') },
    { id: 'practice' as const, icon: <IconTarget size={34} />, title: t('mode.practice.title'), sub: t('mode.practice.long'), tag: t('mode.single') },
    { id: 'localSetup' as const, icon: <IconPeople size={34} />, title: t('mode.local.title'), sub: t('mode.local.long'), tag: t('mode.multi') },
    { id: 'lobby' as const, icon: <IconGlobe size={34} />, title: t('mode.online.title'), sub: t('mode.online.long'), tag: t('mode.multi') },
  ];
  return (
    <Screen id="screen-mode">
      <TopBar title={t('mode.title')} />
      <div className="mode-grid">
        {modes.map((m) => (
          <button key={m.id} type="button" className="mode-card" onClick={() => go(m.id)}>
            <span className="mode-tag">{m.tag}</span>
            <span className="mode-icon">{m.icon}</span>
            <strong>{m.title}</strong>
            <span className="muted">{m.sub}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
