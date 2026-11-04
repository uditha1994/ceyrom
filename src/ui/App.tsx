import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { audio } from '../game/audio';
import { Screen as ScreenName, useApp, useSettings } from '../store/stores';
import { Toasts } from './components/Kit';
import { GameScreen } from './screens/Game';
import { Onboarding, Splash } from './screens/Intro';
import { Lobby } from './screens/Lobby';
import { MainMenu, ModeSelect } from './screens/Menu';
import { Leaderboard, ProfileScreen } from './screens/Profile';
import { Results } from './screens/Results';
import { SettingsScreen } from './screens/Settings';
import { AiSetup, LocalSetup, PracticeMenu } from './screens/Setup';

const SCREENS: Record<ScreenName, () => JSX.Element | null> = {
  splash: Splash,
  onboarding: Onboarding,
  menu: MainMenu,
  mode: ModeSelect,
  aiSetup: AiSetup,
  localSetup: LocalSetup,
  lobby: Lobby,
  game: GameScreen,
  results: Results,
  profile: ProfileScreen,
  leaderboard: Leaderboard,
  settings: SettingsScreen,
  practice: PracticeMenu,
};

export function App() {
  const screen = useApp((s) => s.screen);
  const go = useApp((s) => s.go);
  const theme = useSettings((s) => s.theme);
  const { music, sfx, muted, musicOn } = useSettings();
  const { t, i18n } = useTranslation();

  useEffect(() => {
    // only touch data-theme we set ourselves, so a host page's own theme choice survives
    const root = document.documentElement;
    if (theme === 'system') {
      if (root.dataset.themeOwner === 'app') {
        root.removeAttribute('data-theme');
        delete root.dataset.themeOwner;
      }
    } else {
      root.setAttribute('data-theme', theme);
      root.dataset.themeOwner = 'app';
    }
  }, [theme]);

  useEffect(() => audio.setVolumes(music, sfx, muted), [music, sfx, muted]);

  useEffect(() => {
    audio.setMusic(musicOn);
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [musicOn]);

  // invite links: #room-CODE opens the lobby after the splash
  useEffect(() => {
    if (screen === 'menu' && location.hash.startsWith('#room-')) go('lobby');
    const onHash = () => {
      const s = useApp.getState().screen;
      if (location.hash.startsWith('#room-') && s !== 'game' && s !== 'splash' && s !== 'onboarding') go(s === 'lobby' ? 'menu' : 'lobby');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [screen, go]);

  useEffect(() => {
    document.title = screen === 'game' ? `Ceyrom · ${t('game.title')}` : 'Ceyrom';
  }, [screen, t, i18n.language]);

  const View = SCREENS[screen];
  return (
    <div className={`app lang-${i18n.language}`}>
      <div className="view" key={screen}>
        <View />
      </div>
      <Toasts />
    </div>
  );
}
