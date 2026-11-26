import { useI18n } from '../../shared/i18n/i18n';
import { MessageSquare, NotebookPen } from 'lucide-react';
import { SceneCover } from '../../shared/scene-cover/SceneCover';
import classes from './Scenes.module.css';

export default function Scenes() {
  const { t } = useI18n();
  return (
    <>
      <header className="page-heading"><h1 tabIndex={-1}>{t('scenes.label')}</h1></header>
      <SceneCover />
      <div className={classes['scene-layout']}>
        <section aria-labelledby="sample-dialogue">
          <h2 id="sample-dialogue">{t('scenes.dialogue')}</h2>
          <article className={classes['scene-turn']}>
            <span className="icon-tile" aria-hidden="true"><MessageSquare size={17} /></span>
            <div>
              <h3>{t('scenes.narrator')}</h3>
              <p>{t('scenes.narration')}</p>
            </div>
          </article>
          <article className={classes['scene-turn']}>
            <span className="icon-tile" aria-hidden="true"><NotebookPen size={17} /></span>
            <div>
              <h3>{t('scenes.lina')}</h3>
              <p>{t('scenes.linaLine')}</p>
            </div>
          </article>
        </section>
        <aside className={classes['scene-context']} aria-labelledby="sample-context">
          <h2 id="sample-context">{t('scenes.context')}</h2>
          <dl>
            <dt>{t('scenes.location')}</dt>
            <dd>{t('scenes.station')}</dd>
            <dt>{t('scenes.character')}</dt>
            <dd>{t('scenes.passenger')}</dd>
            <dt>{t('scenes.tone')}</dt>
            <dd>{t('scenes.tension')}</dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
