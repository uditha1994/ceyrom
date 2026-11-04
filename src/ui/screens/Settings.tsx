import { useTranslation } from 'react-i18next';
import { audio } from '../../game/audio';
import { LANGS } from '../../i18n';
import { Lang, useSettings } from '../../store/stores';
import { Field, Screen, Segmented, Slider, Toggle, TopBar } from '../components/Kit';

export function SettingsScreen() {
  const { t } = useTranslation();
  const s = useSettings();
  return (
    <Screen id="screen-settings">
      <TopBar title={t('settings.title')} />
      <div className="settings">
        <section className="settings-group">
          <h2>{t('settings.general')}</h2>
          <Field label={t('settings.language')}>
            <Segmented id="set-lang" label={t('settings.language')} value={s.lang} onChange={(v: Lang) => s.set({ lang: v })} options={LANGS.map((l) => ({ value: l.id, label: <span lang={l.id}>{l.native}</span> }))} />
          </Field>
          <Field label={t('settings.theme')}>
            <Segmented
              id="set-theme"
              label={t('settings.theme')}
              value={s.theme}
              onChange={(v) => s.set({ theme: v })}
              options={[
                { value: 'system', label: t('settings.themeSystem') },
                { value: 'dark', label: t('settings.themeDark') },
                { value: 'light', label: t('settings.themeLight') },
              ]}
            />
          </Field>
        </section>

        <section className="settings-group">
          <h2>{t('settings.audio')}</h2>
          <Toggle id="set-mute" checked={s.muted} label={t('settings.muteAll')} onChange={(v) => s.set({ muted: v })} />
          <Slider id="set-sfx" label={t('settings.sfxVolume')} value={s.sfx} onChange={(v) => (s.set({ sfx: v }), audio.unlock(), audio.play('coin', 0.8))} />
          <Toggle
            id="set-music-on"
            checked={s.musicOn}
            label={t('settings.music')}
            onChange={(v) => {
              s.set({ musicOn: v });
              audio.unlock();
              audio.setMusic(v);
            }}
          />
          <Slider id="set-music" label={t('settings.musicVolume')} value={s.music} onChange={(v) => s.set({ music: v })} />
          <Toggle id="set-vibration" checked={s.vibration} label={t('settings.vibration')} hint={t('settings.vibrationHint')} onChange={(v) => s.set({ vibration: v })} />
        </section>

        <section className="settings-group">
          <h2>{t('settings.controls')}</h2>
          <Field label={t('settings.controlStyle')} hint={t(s.controls === 'slingshot' ? 'settings.slingHint' : 'settings.pointHint')}>
            <Segmented
              id="set-controls"
              label={t('settings.controlStyle')}
              value={s.controls}
              onChange={(v) => s.set({ controls: v })}
              options={[
                { value: 'slingshot', label: t('settings.slingshot') },
                { value: 'point', label: t('settings.point') },
              ]}
            />
          </Field>
          <Field label={t('settings.guide')} hint={t('settings.guideHint')}>
            <Segmented
              id="set-guide"
              label={t('settings.guide')}
              value={s.guide}
              onChange={(v) => s.set({ guide: v })}
              options={[
                { value: 'full', label: t('settings.guideFull') },
                { value: 'short', label: t('settings.guideShort') },
                { value: 'off', label: t('settings.guideOff') },
              ]}
            />
          </Field>
          <div className="keys">
            <h3>{t('settings.keyboard')}</h3>
            <dl>
              {(['move', 'aim', 'power', 'strike', 'pause', 'fine'] as const).map((k) => (
                <div key={k}>
                  <dt>
                    <kbd>{t(`keys.${k}.keys`)}</kbd>
                  </dt>
                  <dd>{t(`keys.${k}.does`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="settings-group">
          <h2>{t('settings.graphics')}</h2>
          <Field label={t('settings.quality')}>
            <Segmented
              id="set-quality"
              label={t('settings.quality')}
              value={s.quality}
              onChange={(v) => s.set({ quality: v })}
              options={[
                { value: 'high', label: t('settings.high') },
                { value: 'low', label: t('settings.low') },
              ]}
            />
          </Field>
          <Field label={t('settings.fps')}>
            <Segmented
              id="set-fps"
              label={t('settings.fps')}
              value={s.fps}
              onChange={(v) => s.set({ fps: v })}
              options={[
                { value: 60, label: '60' },
                { value: 120, label: t('settings.fpsMax') },
              ]}
            />
          </Field>
          <Field label={t('settings.motion')}>
            <Segmented
              id="set-motion"
              label={t('settings.motion')}
              value={s.motion}
              onChange={(v) => s.set({ motion: v })}
              options={[
                { value: 'system', label: t('settings.themeSystem') },
                { value: 'reduce', label: t('settings.motionReduce') },
                { value: 'full', label: t('settings.motionFull') },
              ]}
            />
          </Field>
          <Toggle id="set-lowdata" checked={s.lowData} label={t('settings.lowData')} hint={t('settings.lowDataHint')} onChange={(v) => s.set({ lowData: v, quality: v ? 'low' : s.quality })} />
        </section>

        <section className="settings-group">
          <h2>{t('settings.online')}</h2>
          <label className="field" htmlFor="set-server">
            <span className="field-label">{t('settings.server')}</span>
            <input id="set-server" className="input" placeholder={t('settings.serverPlaceholder')} value={s.serverUrl} onChange={(e) => s.set({ serverUrl: e.target.value })} inputMode="url" autoComplete="url" />
            <span className="hint">{t('settings.serverHint')}</span>
          </label>
        </section>
      </div>
    </Screen>
  );
}
