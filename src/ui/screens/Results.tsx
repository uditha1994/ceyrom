import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { teamOf } from '../../core/rules';
import { loadAiPrefs, makeAiSession } from '../../game/sessions';
import { fmtNumber } from '../../i18n';
import { net } from '../../net/client';
import { levelFor, useApp, useProfile } from '../../store/stores';
import { Avatar, PetalRule } from '../components/Art';
import { IconRefresh, IconTrophy } from '../components/Icons';
import { Button, Screen } from '../components/Kit';

export function Results() {
  const { t } = useTranslation();
  const result = useApp((s) => s.result);
  const start = useApp((s) => s.startSession);
  const go = useApp((s) => s.go);
  const xp = useProfile((s) => s.xp);
  useEffect(() => {
    if (!result) go('menu', { replace: true });
  }, [result, go]);
  if (!result) return null;
  const { state, session, myTeam } = result;
  const local = session.kind === 'local';
  const won = state.winner === myTeam;
  const draw = state.winner === -1;
  const headline = local
    ? draw
      ? t('results.draw')
      : t('results.teamWins', { name: teamName(session, state.winner) })
    : draw
      ? t('results.draw')
      : won
        ? t('results.won')
        : t('results.lost');
  const best = state.bestShot;
  const levelNow = levelFor(xp);
  const levelBefore = levelFor(xp - result.xp);

  const rematch = () => {
    if (session.kind === 'ai') start(makeAiSession({ ...loadAiPrefs(), difficulty: session.difficulty ?? 'medium' }));
    else if (session.kind === 'online') {
      net.send({ type: 'rematch' });
      go('lobby', { replace: true });
    } else start({ ...session, seed: (Math.random() * 1e9) | 0, initialState: undefined });
  };

  return (
    <Screen className={`results ${won && !local ? 'won' : ''}`} id="screen-results">
      <section className="results-head rise">
        <IconTrophy size={44} />
        <h1>{headline}</h1>
        {result.forfeit && <p className="muted">{t('results.forfeit')}</p>}
        <div className="scoreline">
          {[0, 1].map((team) => (
            <div key={team} className={`score-side${state.winner === team ? ' win' : ''}`}>
              <div className="avatars">
                {session.players
                  .map((p, i) => ({ p, i }))
                  .filter(({ i }) => teamOf(i) === team)
                  .map(({ p, i }) => (
                    <Avatar key={i} id={p.avatar} size={48} />
                  ))}
              </div>
              <strong>{teamName(session, team)}</strong>
              <span className="big-num">{fmtNumber(state.scores[team])}</span>
            </div>
          ))}
        </div>
      </section>

      <PetalRule />

      <section className="stats-grid">
        <table className="stats-table">
          <thead>
            <tr>
              <th scope="col">{t('results.player')}</th>
              <th scope="col">{t('results.shots')}</th>
              <th scope="col">{t('results.pocketed')}</th>
              <th scope="col">{t('results.fouls')}</th>
              <th scope="col">{t('results.queens')}</th>
            </tr>
          </thead>
          <tbody>
            {state.stats.map((s, i) => (
              <tr key={i}>
                <th scope="row">{session.players[i]?.name}</th>
                <td>{fmtNumber(s.shots)}</td>
                <td>{fmtNumber(s.pocketed)}</td>
                <td>{fmtNumber(s.fouls)}</td>
                <td>{fmtNumber(s.queens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="side-stats">
          <div className="stat-card">
            <small>{t('results.boards')}</small>
            <strong>{fmtNumber(state.results.length)}</strong>
          </div>
          {best && (
            <div className="stat-card">
              <small>{t('results.shotOfMatch')}</small>
              <strong>{t('results.shotOfMatchBody', { name: session.players[best.seat]?.name, n: best.scored, board: best.board })}</strong>
            </div>
          )}
          {!local && (
            <div className="stat-card">
              <small>{t('results.xp')}</small>
              <strong>
                +{fmtNumber(result.xp)} XP{levelNow > levelBefore ? ` · ${t('results.levelUp', { n: levelNow })}` : ''}
              </strong>
            </div>
          )}
          {result.ratingDelta !== undefined && result.ratingDelta !== 0 && (
            <div className="stat-card">
              <small>{t('profile.rating')}</small>
              <strong className={result.ratingDelta > 0 ? 'good' : 'bad'}>
                {result.ratingDelta > 0 ? '+' : ''}
                {fmtNumber(result.ratingDelta)}
              </strong>
            </div>
          )}
          {result.achievements.map((a) => (
            <div key={a} className="stat-card ach">
              <small>{t('results.unlocked')}</small>
              <strong>{t(`ach.${a}.title`)}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="results-actions">
        <Button variant="secondary" size="lg" onClick={() => go('menu', { replace: true })}>
          {t('common.menu')}
        </Button>
        <Button size="lg" icon={<IconRefresh />} onClick={rematch} id="btn-rematch">
          {t('results.rematch')}
        </Button>
      </div>
    </Screen>
  );
}

function teamName(session: { players: { name: string }[]; seats: number }, team: number): string {
  if (team < 0) return '';
  return session.players
    .filter((_, i) => teamOf(i) === team)
    .map((p) => p.name)
    .join(' & ');
}
