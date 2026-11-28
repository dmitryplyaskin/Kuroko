import { ActionIcon, Input, Modal, Tabs, Textarea, Tooltip, type TextareaProps } from '@mantine/core';
import { Info } from 'lucide-react';
import { useId, useState, type Ref } from 'react';
import { useI18n, type MessageKey } from '../i18n/i18n';
import './templateHelp.css';

export type TemplateScope = 'chat' | 'agent' | 'world' | 'worldValue' | 'persona' | 'personaValue';
type Reference = readonly [expression: string, description: MessageKey];

export function PromptTextarea({ scope, ref, id, label, size, required, withAsterisk, ...props }:
  TextareaProps & { scope: TemplateScope; ref?: Ref<HTMLTextAreaElement> }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const field = typeof label === 'string' ? label : props['aria-label'];
  return <div className="prompt-textarea">
    <div className="prompt-textarea-heading">
      {label && <Input.Label htmlFor={inputId} size={size} required={withAsterisk ?? required} style={{ marginBlockEnd: 0 }}>{label}</Input.Label>}
      <TemplateHelp scope={scope} field={field} />
    </div>
    <Textarea {...props} id={inputId} size={size} required={required} ref={ref} />
  </div>;
}

function TemplateHelp({ scope, field }: { scope: TemplateScope; field?: string }) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const label = field ? t('templates.openGuideFor', { field }) : t('templates.guide');
  return <>
    <Tooltip label={t('templates.guideTitle')} events={{ hover: true, focus: true, touch: false }}>
      <ActionIcon type="button" variant="subtle" size={24} className="template-help-trigger" aria-label={label}
        aria-haspopup="dialog" onClick={() => setOpened(true)}>
        <Info size={16} strokeWidth={1.5} aria-hidden="true" />
      </ActionIcon>
    </Tooltip>
    <TemplateGuideModal scope={scope} field={field} opened={opened} onClose={() => setOpened(false)} />
  </>;
}

export function TemplateGuideModal({ scope, field, opened, onClose, onExitTransitionEnd }: {
  scope: TemplateScope;
  field?: string;
  opened: boolean;
  onClose: () => void;
  onExitTransitionEnd?: () => void;
}) {
  const { t } = useI18n();
  return <Modal opened={opened} onClose={onClose} onExitTransitionEnd={onExitTransitionEnd} returnFocus={!onExitTransitionEnd}
    title={t('templates.guideTitle')} size="52rem" closeButtonProps={{ 'aria-label': t('common.close') }}
    classNames={{ header: 'template-guide-header', title: 'template-guide-title', body: 'template-guide-body' }}>
    {opened && <Guide scope={scope} field={field} />}
  </Modal>;
}

const worlds: Reference[] = [
  ['vars.difficulty', 'templates.help.variables'],
  ['world()', 'templates.help.currentWorld'],
  ['world().title', 'templates.help.worldTitle'],
  ['world().base, world().context', 'templates.help.world'],
  ['world().description, world().author_notes', 'templates.help.metadata'],
  ['world().characters, world().lorebook, world().sections', 'templates.help.records'],
  ['world().starts', 'templates.help.starts'],
  ['world(id, startId, personaId).player_persona', 'templates.help.playerPersona'],
];
const personas: Reference[] = [
  ['persona.name, persona.description', 'templates.help.activePersona'],
  ['{{user}}', 'templates.help.userAlias'],
  ['persona.vars.rank', 'templates.help.personaVars'],
  ['world(id, startId, persona.id).player_persona', 'templates.help.activePlayerRole'],
];

function Guide({ scope, field }: { scope: TemplateScope; field?: string }) {
  const { t } = useI18n();
  const variables: Reference[] = scope === 'agent' ? [['agent.name', 'templates.help.agent']]
    : scope === 'chat' ? [['chat.title', 'templates.help.chatTitle'], ['chat.gm_mode', 'templates.help.gmMode']] : [];
  return <div className="template-guide">
    {field && <p className="template-guide-field">{field}</p>}
    <Tabs defaultValue="syntax" classNames={{ list: 'template-guide-tabs', tab: 'template-guide-tab', panel: 'template-guide-panel' }}>
      <Tabs.List aria-label={t('templates.guideTitle')}>
        <Tabs.Tab value="syntax">{t('templates.tabs.syntax')}</Tabs.Tab>
        <Tabs.Tab value="variables">{t('templates.tabs.variables')}</Tabs.Tab>
        <Tabs.Tab value="functions">{t('templates.tabs.functions')}</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="syntax">
        {(scope === 'worldValue' || scope === 'personaValue') && <p className="template-guide-note">{t('templates.help.jsonStrings')}</p>}
        <div className="template-guide-example">
          <div>
            <h3>{t('templates.syntax.example')}</h3>
            <p>{t('templates.help.syntax')}</p>
          </div>
          <figure>
            <pre dir="ltr"><code>{`@ set detail = (2 + 1) * 2\n@ if detail >= 5\n${t('templates.syntax.outputLabel')} {{ detail }}\n@ endif`}</code></pre>
            <figcaption>{t('templates.syntax.result')} <strong>{t('templates.syntax.outputLabel')} 6</strong></figcaption>
          </figure>
        </div>
        <ReferenceList rows={[
          ['{{ value }}', 'templates.syntax.output'],
          ['@ set / @ if / @ else / @ endif', 'templates.syntax.condition'],
          ['@ for item in list / @ endfor', 'templates.syntax.loop'],
          ['{% raw %}{{ example }}{% endraw %}', 'templates.syntax.raw'],
        ]} />
      </Tabs.Panel>
      <Tabs.Panel value="variables">
        <p>{t(scope === 'persona' || scope === 'personaValue' ? 'templates.help.personaScope'
          : scope === 'world' || scope === 'worldValue' ? 'templates.help.worldScope' : 'templates.help.boundWorld')}</p>
        <ReferenceList rows={[...variables, ...personas, ...worlds]} />
      </Tabs.Panel>
      <Tabs.Panel value="functions">
        <ReferenceList rows={[
          ['+  −  *  /  %', 'templates.functions.math'],
          ['==  !=  >  >=  <  <=', 'templates.functions.compare'],
          ['and  or  not  in', 'templates.functions.logic'],
          ['true, false, none', 'templates.help.literals'],
          ['clamp(value, min, max)', 'templates.help.clamp'],
          ['range(1, 4)', 'templates.functions.range'],
          ['value | default(0), list | join(", ")', 'templates.functions.filters'],
          ['@ macro label(name) / @ endmacro', 'templates.functions.macro'],
        ]} />
      </Tabs.Panel>
    </Tabs>
  </div>;
}

function ReferenceList({ rows }: { rows: Reference[] }) {
  const { t } = useI18n();
  return <dl className="template-reference">
    {rows.map(([expression, description]) => <div key={expression}>
      <dt><code dir="ltr">{expression}</code></dt><dd>{t(description)}</dd>
    </div>)}
  </dl>;
}
