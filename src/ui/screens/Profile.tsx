import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublicProfile } from '../../core/protocol';
import { ACHIEVEMENTS, favouriteMode } from '../../game/progress';
import { BOARD_THEMES, STRIKER_SKINS } from '../../game/themes';
import { fmtDate, fmtNumber } from '../../i18n';
import { net } from '../../net/client';
import { levelFor, useProfile, useSettings, xpForLevel } from '../../store/stores';
import { AVATAR_COUNT, Avatar } from '../components/Art';
import { IconLock } from '../components/Icons';
import { Field, Screen, Segmented, TopBar } from '../components/Kit';

export const COUNTRIES = ['LK', 'IN', 'MV', 'AU', 'GB', 'CA', 'AE', 'QA', 'IT', 'OTHER'];

export function ProfileScreen() {
  const { t } = useTranslation();
  const p = useProfile();
  const s = useSettings();
  const level = levelFor(p.xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const pct = Math.round(((p.xp - from) / (to - from)) * 100);
  const winPct = p.matches ? Math.round((p.wins / Math.max(1, p.wins + p.losses)) * 100) : 0;
  const fav = favouriteMode(p);
  return (
    <Screen id="screen-profile">
      <TopBar title={t('profile.title')} />
      <div className="profile">
        <section className="profile-head">
          <Avatar id={p.avatar} size={88} ring="var(--brass)" />
          <div className="profile-id">
            <label htmlFor="profile-name" className="sr-only">
              {t('profile.nickname')}
            </label>
            <input id="profile-name" className="input name-input" value={p.name} maxLength={18} onChange={(e) => p.update({ name: e.target.value })} />
            <div className="level-row">
              <span className="badge">{t('profile.level', { n: fmtNumber(level) })}</span>
              <div className="xpbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('profile.xpTo', { n: level + 1 })}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <small className="muted">
                {fmtNumber(p.xp - from)} / {fmtNumber(to - from)} XP
              </small>
            </div>
          </div>
        </section>

        <section className="stat-row">
          {[
            [t('profile.matches'), p.matches],
            [t('profile.wins'), p.wins],
            [t('profile.losses'), p.losses],
            [t('profile.winPct'), `${fmtNumber(winPct)}%`],
            [t('profile.rating'), p.rating],
            [t('profile.best'), p.bestRating],
          ].map(([k, v]) => (
            <div className="stat-card" key={String(k)}>
              <small>{k}</small>
              <strong>{typeof v === 'number' ? fmtNumber(v) : v}</strong>
            </div>
          ))}
          <div className="stat-card">
            <small>{t('profile.favourite')}</small>
            <strong>{fav ? t(`modeName.${fav}`) : '—'}</strong>
          </div>
        </section>

        <Field label={t('profile.avatar')}>
          <div className="avatar-grid">
            {Array.from({ length: AVATAR_COUNT }, (_, i) => (
              <button key={i} type="button" className={`avatar-pick${p.avatar === i ? ' on' : ''}`} onClick={() => p.update({ avatar: i })} aria-label={t(`avatar.${i}`)} aria-pressed={p.avatar === i}>
                <Avatar id={i} size={48} />
              </button>
            ))}
          </div>
        </Field>

        <Field label={t('profile.country')}>
          <select id="profile-country" className="input select" value={p.country} onChange={(e) => p.update({ country: e.target.value })}>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {t(`country.${c}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('profile.collection')} hint={t('profile.collectionHint')}>
          <div className="collection">
            {BOARD_THEMES.map((b) => {
              const locked = level < b.unlock;
              return (
                <button key={b.id} type="button" className={`theme-swatch${s.board === b.id ? ' on' : ''}`} disabled={locked} onClick={() => s.set({ board: b.id })} aria-pressed={s.board === b.id}>
                  <span className="swatch" style={{ background: b.surface[0], borderColor: b.frame[0] }} />
                  <span>{t(`board.${b.id}`)}</span>
                  {locked && (
                    <small>
                      <IconLock size={14} /> {t('profile.unlockAt', { n: b.unlock })}
                    </small>
                  )}
                </button>
              );
            })}
          </div>
          <div className="collection">
            {STRIKER_SKINS.map((k) => {
              const locked = level < k.unlock;
              return (
                <button key={k.id} type="button" className={`theme-swatch${s.striker === k.id ? ' on' : ''}`} disabled={locked} onClick={() => s.set({ striker: k.id })} aria-pressed={s.striker === k.id}>
                  <span className={`swatch round skin-${k.id}`} />
                  <span>{t(`skin.${k.id}`)}</span>
                  {locked && (
                    <small>
                      <IconLock size={14} /> {t('profile.unlockAt', { n: k.unlock })}
                    </small>
                  )}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t('profile.achievements')}>
          <ul className="ach-list">
            {ACHIEVEMENTS.map((a) => {
              const got = p.achievements.includes(a);
              return (
                <li key={a} className={got ? 'got' : ''}>
                  <span className="ach-medal" aria-hidden>
                    {got ? '✦' : '◇'}
                  </span>
                  <span>
                    <strong>{t(`ach.${a}.title`)}</strong>
                    <small>{t(`ach.${a}.body`)}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        </Field>

        <Field label={t('profile.history')}>
          {p.history.length === 0 ? (
            <p className="muted">{t('profile.noHistory')}</p>
          ) : (
            <ul className="history">
              {p.history.map((h, i) => (
                <li key={i}>
                  <span className={`result-dot ${h.won === true ? 'w' : h.won === false ? 'l' : 'd'}`}>{h.won === true ? t('profile.w') : h.won === false ? t('profile.l') : '–'}</span>
                  <span className="h-main">
                    <strong>{h.opponent}</strong>
                    <small>
                      {t(`modeName.${h.mode}`)}
                      {h.difficulty ? ` · ${t(`ai.level.${h.difficulty}`)}` : ''} · {fmtDate(h.at)}
                    </small>
                  </span>
                  <span className="h-score">
                    {fmtNumber(h.score[0])}–{fmtNumber(h.score[1])}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </div>
    </Screen>
  );
}

type Scope = 'global' | 'lk' | 'weekly' | 'monthly' | 'friends';

export function Leaderboard() {
  const { t } = useTranslation();
  const p = useProfile();
  const [scope, setScope] = useState<Scope>('global');
  const [rows, setRows] = useState<(PublicProfile & { rank: number })[] | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let alive = true;
    setRows(null);
    setOffline(false);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    fetch(`${net.httpBase()}/api/leaderboard?scope=${scope}${net.playerId ? `&me=${net.playerId}` : ''}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { rows: (PublicProfile & { rank: number })[] }) => alive && setRows(d.rows))
      .catch(() => {
        if (!alive) return;
        setOffline(true);
        setRows([{ rank: 1, id: p.id, name: p.name || t('onboard.defaultName'), avatar: p.avatar, country: p.country, rating: p.rating, bestRating: p.bestRating, wins: p.wins, losses: p.losses, matches: p.matches }]);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [scope, p.id, p.name, p.avatar, p.country, p.rating, p.bestRating, p.wins, p.losses, p.matches, t]);
  return (
    <Screen id="screen-leaderboard">
      <TopBar title={t('leaderboard.title')} />
      <div className="leaderboard">
        <Segmented
          id="lb-scope"
          label={t('leaderboard.scope')}
          value={scope}
          onChange={setScope}
          options={(['global', 'lk', 'weekly', 'monthly', 'friends'] as Scope[]).map((s) => ({ value: s, label: t(`leaderboard.${s}`) }))}
        />
        {offline && <p className="muted notice">{t('leaderboard.offline')}</p>}
        {rows === null ? (
          <p className="muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="muted">{t('leaderboard.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="lb-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t('results.player')}</th>
                  <th scope="col">{t('profile.rating')}</th>
                  <th scope="col">{t('profile.wins')}</th>
                  <th scope="col">{t('profile.matches')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.id === net.playerId || r.id === p.id ? 'me' : ''}>
                    <td className="rank">{fmtNumber(r.rank)}</td>
                    <th scope="row">
                      <span className="lb-player">
                        <Avatar id={r.avatar} size={30} /> {r.name} <small className="muted">{r.country}</small>
                      </span>
                    </th>
                    <td>{fmtNumber(r.rating)}</td>
                    <td>{fmtNumber(r.wins)}</td>
                    <td>{fmtNumber(r.matches)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Screen>
  );
}
