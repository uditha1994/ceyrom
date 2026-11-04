import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGS } from '../../i18n';
import { Lang, useApp, useProfile, useSettings } from '../../store/stores';
import { AVATAR_COUNT, Avatar, Mark, PetalRule, Wordmark } from '../components/Art';
import { Button, Screen } from '../components/Kit';

export function Splash() {
  const { t } = useTranslation();
  const go = useApp((s) => s.go);
  const onboarded = useSettings((s) => s.onboarded);
  const [progress, setProgress] = useState(0.1);
  useEffect(() => {
    let alive = true;
    const started = performance.now();
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const ready = Promise.race([fonts ? fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2200))]);
    setProgress(0.45);
    void ready.then(async () => {
      if (!alive) return;
      setProgress(0.85);
      const wait = Math.max(0, 1300 - (performance.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (!alive) return;
      setProgress(1);
      setTimeout(() => alive && go(onboarded ? 'menu' : 'onboarding', { replace: true }), 260);
    });
    return () => {
      alive = false;
    };
  }, [go, onboarded]);
  return (
    <Screen className="splash" id="screen-splash">
      <div className="splash-mark">
        <Mark size={104} spin />
      </div>
      <Wordmark size={64} />
      <p className="splash-tag">{t('brand.tagline')}</p>
      <div className="loader" role="progressbar" aria-label={t('splash.loading')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
    </Screen>
  );
}

export function Onboarding() {
  const { t } = useTranslation();
  const setSettings = useSettings((s) => s.set);
  const lang = useSettings((s) => s.lang);
  const profile = useProfile();
  const go = useApp((s) => s.go);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);

  const slides = [
    { title: t('onboard.s1.title'), body: t('onboard.s1.body') },
    { title: t('onboard.s2.title'), body: t('onboard.s2.body') },
    { title: t('onboard.s3.title'), body: t('onboard.s3.body') },
  ];

  const finish = () => {
    profile.update({ name: name.trim().slice(0, 18) || t('onboard.defaultName'), avatar });
    setSettings({ onboarded: true });
    go('menu', { replace: true });
  };

  return (
    <Screen className="onboarding" id="screen-onboarding">
      <div className="onboard-head">
        <Mark size={56} />
        <Wordmark size={40} />
      </div>
      {step === 0 && (
        <section className="onboard-card rise">
          <h2>{t('onboard.chooseLang')}</h2>
          <p className="muted">{t('onboard.langHint')}</p>
          <div className="lang-grid">
            {LANGS.map((l) => (
              <button key={l.id} type="button" className={`lang-tile${lang === l.id ? ' on' : ''}`} lang={l.id} onClick={() => setSettings({ lang: l.id as Lang })}>
                <span className="lang-native">{l.native}</span>
                <span className="lang-sample">{l.id === 'en' ? 'Play carrom' : l.id === 'si' ? 'කැරම් ක්‍රීඩා කරමු' : 'கேரம் விளையாடுவோம்'}</span>
              </button>
            ))}
          </div>
          <Button size="lg" wide onClick={() => setStep(1)}>
            {t('common.continue')}
          </Button>
        </section>
      )}
      {step >= 1 && step <= 3 && (
        <section className="onboard-card rise" key={step}>
          <div className="slide-art" aria-hidden>
            <SlideArt n={step} />
          </div>
          <h2>{slides[step - 1].title}</h2>
          <p>{slides[step - 1].body}</p>
          <div className="dots" aria-hidden>
            {[1, 2, 3].map((i) => (
              <span key={i} className={i === step ? 'on' : ''} />
            ))}
          </div>
          <div className="row">
            <Button variant="ghost" onClick={() => setStep(4)}>
              {t('common.skip')}
            </Button>
            <Button size="lg" onClick={() => setStep(step + 1)}>
              {t('common.next')}
            </Button>
          </div>
        </section>
      )}
      {step === 4 && (
        <section className="onboard-card rise">
          <h2>{t('onboard.whoAreYou')}</h2>
          <label className="field" htmlFor="onboard-name">
            <span className="field-label">{t('profile.nickname')}</span>
            <input id="onboard-name" className="input" value={name} maxLength={18} placeholder={t('onboard.namePlaceholder')} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          </label>
          <div className="field-label">{t('profile.avatar')}</div>
          <div className="avatar-grid">
            {Array.from({ length: AVATAR_COUNT }, (_, i) => (
              <button key={i} type="button" className={`avatar-pick${avatar === i ? ' on' : ''}`} onClick={() => setAvatar(i)} aria-label={t(`avatar.${i}`)} aria-pressed={avatar === i}>
                <Avatar id={i} size={52} />
              </button>
            ))}
          </div>
          <Button size="lg" wide onClick={finish}>
            {t('onboard.start')}
          </Button>
        </section>
      )}
      <PetalRule className="onboard-rule" />
    </Screen>
  );
}

function SlideArt({ n }: { n: number }) {
  if (n === 1)
    return (
      <svg viewBox="0 0 200 120" width="200" height="120">
        <rect x="40" y="6" width="120" height="108" rx="6" fill="var(--wood)" />
        <rect x="50" y="14" width="100" height="92" rx="2" fill="var(--ivory)" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={i} cx={100 + Math.cos((i * Math.PI) / 3) * 11} cy={56 + Math.sin((i * Math.PI) / 3) * 11} r="5" fill={i % 2 ? 'var(--ebony)' : '#EEDFC2'} stroke="var(--brass)" strokeWidth=".6" />
        ))}
        <circle cx="100" cy="56" r="5" fill="var(--queen)" />
        <circle cx="100" cy="94" r="7" fill="#F3E8D2" stroke="var(--brass)" />
      </svg>
    );
  if (n === 2)
    return (
      <svg viewBox="0 0 200 120" width="200" height="120">
        <circle cx="100" cy="92" r="11" fill="#F3E8D2" stroke="var(--brass)" strokeWidth="1.5" />
        <path d="M100 81 L100 20" stroke="var(--brass)" strokeWidth="2" strokeDasharray="5 4" />
        <path d="M100 103 L100 114" stroke="var(--ivory)" strokeWidth="2" />
        <circle cx="100" cy="116" r="3" fill="var(--ivory)" />
        <circle cx="100" cy="14" r="6" fill="#EEDFC2" stroke="var(--brass)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 200 120" width="200" height="120">
      <circle cx="70" cy="60" r="28" fill="var(--wood)" />
      <circle cx="130" cy="60" r="28" fill="var(--olive)" />
      <circle cx="70" cy="60" r="9" fill="var(--queen)" />
      <circle cx="130" cy="60" r="9" fill="#EEDFC2" />
      <path d="M96 60 h8" stroke="var(--brass)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
