import type { Realm } from '@kuroko/contracts/realms';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';

export const realmParts = ['base', 'characters', 'lorebook', 'starts', 'variables'] as const;
type StandardPart = typeof realmParts[number];
export type RealmPart = StandardPart | `section:${string}`;

export function sectionPart(id: string): `section:${string}` {
  return `section:${id}`;
}

export function getRealmSection(realm: Realm, part: RealmPart) {
  if (part.startsWith('section:')) return realm.sections?.find((section) => sectionPart(section.id) === part);
}

function isStandardPart(part: RealmPart): part is StandardPart {
  return realmParts.some((name) => name === part);
}

export function RealmContents({ realm, variableCount, part, onPart, onCreateSection, children }: {
  realm: Realm;
  variableCount: number;
  part: RealmPart;
  onPart: (part: RealmPart) => void;
  onCreateSection: () => void;
  children: ReactNode;
}) {
  const { t, number } = useI18n();
  const panel = useId();
  const index = useRef<HTMLElement>(null);
  const untitledSection = t('realms.untitledSection');
  const partTitle = isStandardPart(part) ? t(`realms.part.${part}`) : getRealmSection(realm, part)?.title.trim() || untitledSection;

  useEffect(() => {
    const nav = index.current;
    const active = nav?.querySelector('[aria-current]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const frame = nav.getBoundingClientRect();
    const choice = active.getBoundingClientRect();
    nav.scrollLeft += Math.min(0, choice.left - frame.left) || Math.max(0, choice.right - frame.right);
  }, [part]);

  function sectionButton(id: RealmPart, title: string, count?: number) {
    return <button type="button" key={id} className="realms-index-choice" aria-current={part === id ? 'true' : undefined}
      aria-controls={panel} onClick={() => onPart(id)}>
      <span>{title}</span>
      {count !== undefined && <span className="realms-index-count">{number.format(count)}</span>}
    </button>;
  }
  return (
    <div className="realms-workbench">
      <div className="realms-index-area">
        <nav className="realms-index" aria-label={t('realms.index')} ref={index}>
          <div className="realms-index-group">
            {realmParts.map((section) => sectionButton(section, t(`realms.part.${section}`),
              section === 'base' ? undefined : section === 'variables' ? variableCount : realm[section]?.length ?? 0))}
          </div>
          {Boolean(realm.sections?.length) && <div className="realms-index-group realms-index-custom">
            {realm.sections?.map((section) => sectionButton(sectionPart(section.id), section.title.trim() || untitledSection, section.entries.length))}
          </div>}
        </nav>
        <button type="button" className="realms-index-choice realms-create-section" onClick={onCreateSection}>
          <Plus size={16} aria-hidden="true" /><span>{t('realms.createSection')}</span>
        </button>
      </div>
      <section id={panel} className="realms-paper" aria-label={partTitle}>
        <h2 className="realms-part-title">{partTitle}</h2>
        {children}
      </section>
    </div>
  );
}
