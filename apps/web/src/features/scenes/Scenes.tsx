import { MessageSquare, NotebookPen } from 'lucide-react';
import { SceneCover } from './SceneCover';
import './scenes.css';

export function Scenes() {
  return (
    <>
      <header className="page-heading"><h1 tabIndex={-1}>Сцены</h1></header>
      <SceneCover />
      <div className="scene-layout">
        <section aria-labelledby="sample-dialogue" className="scene-dialogue">
          <h2 id="sample-dialogue">Диалог</h2>
          <article className="scene-turn">
            <span className="icon-tile" aria-hidden="true"><MessageSquare size={17} /></span>
            <div>
              <h3>Рассказчик</h3>
              <p>Табло погасло. На пустой платформе мигнула лампа, и из тумана донёсся звук шагов. Лина убрала билет в карман.</p>
            </div>
          </article>
          <article className="scene-turn">
            <span className="icon-tile" aria-hidden="true"><NotebookPen size={17} /></span>
            <div>
              <h3>Лина</h3>
              <p>«Вы тоже ждёте последний поезд?» Я отступаю под навес, чтобы разглядеть, кто идёт.</p>
            </div>
          </article>
        </section>
        <aside className="scene-context" aria-labelledby="sample-context">
          <h2 id="sample-context">Контекст</h2>
          <dl>
            <dt>Место</dt>
            <dd>Прибрежная станция</dd>
            <dt>Персонаж</dt>
            <dd>Лина, пассажирка</dd>
            <dt>Тон</dt>
            <dd>Тихое напряжение</dd>
          </dl>
        </aside>
      </div>
    </>
  );
}
