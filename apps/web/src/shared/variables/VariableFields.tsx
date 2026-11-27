import { Button, Select, TextInput } from '@mantine/core';
import { variableLimit, variableValueLimit } from '@kuroko/contracts/variables';
import { Plus, Trash2 } from 'lucide-react';
import { newLocalId } from '../browser/id';
import { useI18n } from '../i18n/i18n';
import { PromptTextarea } from '../prompt-templates/TemplateHelp';
import type { VariableDraft } from './variableDraft';
import classes from './VariableFields.module.css';

export function VariableFields({ variables, issue, disabled, scope, onChange }: {
  variables: VariableDraft[];
  issue?: string;
  disabled?: boolean;
  scope: 'worldValue' | 'personaValue';
  onChange: (variables: VariableDraft[]) => void;
}) {
  const { t, number } = useI18n();

  function update(index: number, change: Partial<VariableDraft>) {
    onChange(variables.map((entry, current) => current === index ? { ...entry, ...change } : entry));
  }

  return <div className={classes.fields}>
    {variables.map(({ id, name, source, format }, index) => {
      const valueProps = {
        label: t('variables.value'), value: source, maxLength: variableValueLimit, autosize: true, minRows: 2, maxRows: 10,
        error: issue === `/variables/${index}/value`, dir: format === 'json' ? 'ltr' : 'auto', disabled,
        description: format === 'json' ? t('variables.jsonHelp') : undefined,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => update(index, { source: event.currentTarget.value }),
      };
      return <div key={id} className={classes.row}>
        <div className={classes.metadata}>
          <TextInput label={t('variables.name')} placeholder="difficulty" value={name} maxLength={64} dir="ltr" required disabled={disabled}
            error={issue === `/variables/${index}/name`} onChange={(event) => update(index, { name: event.currentTarget.value })} />
          <Select label={t('variables.format')} value={format} allowDeselect={false} disabled={disabled}
            data={[{ value: 'text', label: t('variables.text') }, { value: 'json', label: t('variables.json') }]}
            onChange={(next) => { if (next === 'text' || next === 'json') update(index, { format: next }); }} />
        </div>
        <PromptTextarea scope={scope} {...valueProps} />
        <Button type="button" variant="subtle" color="red" disabled={disabled}
          aria-label={t('variables.removeNumber', { number: number.format(index + 1) })} leftSection={<Trash2 size={16} aria-hidden="true" />}
          onClick={() => onChange(variables.filter((_, current) => current !== index))}>{t('variables.remove')}</Button>
      </div>;
    })}
    <Button type="button" variant="default" disabled={disabled || variables.length >= variableLimit}
      leftSection={<Plus size={16} aria-hidden="true" />} onClick={() => onChange([...variables, { id: newLocalId(), name: '', source: '', format: 'text' }])}>
      {t('variables.add')}
    </Button>
  </div>;
}
