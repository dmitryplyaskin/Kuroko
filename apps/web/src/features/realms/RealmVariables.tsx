import { Button, Select, TextInput } from '@mantine/core';
import { isRealmVariableName, realmVariableLimit, realmVariableValueLimit } from '@kuroko/contracts/realms';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import { newRealmId, type VariableDraft } from './model';
import classes from './Realms.module.css';

export function RealmVariables({ variables, issue, onChange }: {
  variables: VariableDraft[];
  issue?: string;
  onChange: (variables: VariableDraft[]) => void;
}) {
  const { t } = useI18n();
  const sampleName = variables.find(({ name }) => isRealmVariableName(name))?.name ?? 'difficulty';

  function update(index: number, change: Partial<VariableDraft>) {
    onChange(variables.map((entry, current) => current === index ? { ...entry, ...change } : entry));
  }

  return <div className={[classes['realms-record-fields'], classes['realms-variables']].join(' ')}>
    <div className={classes['realms-variable-help']}>
      <p>{t('realms.variables.help')}</p>
      <code dir="ltr">{`{{ vars.${sampleName} }}`}</code>
    </div>
    {variables.map(({ id, name, source, format }, index) => <div key={id} className={classes['realms-variable']}>
      <div className={classes['realms-metadata-fields']}>
        <TextInput label={t('realms.variables.name')} placeholder="difficulty" value={name} maxLength={64} dir="ltr" required
          error={issue === `/variables/${index}/name`} onChange={(event) => update(index, { name: event.currentTarget.value })} />
        <Select label={t('realms.variables.format')} value={format} allowDeselect={false}
          data={[{ value: 'text', label: t('realms.variables.text') }, { value: 'json', label: t('realms.variables.json') }]}
          onChange={(next) => { if (next === 'text' || next === 'json') update(index, { format: next }); }} />
      </div>
      <PromptTextarea scope="worldValue" label={t('realms.variables.value')} value={source} maxLength={realmVariableValueLimit} autosize minRows={2} maxRows={10}
        error={issue === `/variables/${index}/value`} dir={format === 'json' ? 'ltr' : 'auto'}
        description={format === 'json' ? t('realms.variables.jsonHelp') : undefined}
        onChange={(event) => update(index, { source: event.currentTarget.value })} />
      <Button type="button" variant="subtle" color="red" leftSection={<Trash2 size={16} aria-hidden="true" />}
        onClick={() => onChange(variables.filter((_, current) => current !== index))}>{t('realms.variables.remove')}</Button>
    </div>)}
    <Button type="button" variant="default" disabled={variables.length >= realmVariableLimit} leftSection={<Plus size={16} aria-hidden="true" />}
      onClick={() => onChange([...variables, { id: newRealmId(), name: '', source: '', format: 'text' }])}>
      {t('realms.variables.add')}
    </Button>
  </div>;
}
