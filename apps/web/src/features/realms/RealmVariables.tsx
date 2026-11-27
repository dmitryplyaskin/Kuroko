import { isVariableName } from '@kuroko/contracts/variables';
import { useI18n } from '../../shared/i18n/i18n';
import { VariableFields } from '../../shared/variables/VariableFields';
import type { VariableDraft } from '../../shared/variables/variableDraft';
import classes from './Realms.module.css';

export function RealmVariables({ variables, issue, onChange }: {
  variables: VariableDraft[];
  issue?: string;
  onChange: (variables: VariableDraft[]) => void;
}) {
  const { t } = useI18n();
  const sampleName = variables.find(({ name }) => isVariableName(name))?.name ?? 'difficulty';

  return <div className={classes['realms-record-fields']}>
    <div className={classes['realms-variable-help']}>
      <p>{t('realms.variables.help')}</p>
      <code dir="ltr">{`{{ vars.${sampleName} }}`}</code>
    </div>
    <VariableFields scope="worldValue" variables={variables} issue={issue} onChange={onChange} />
  </div>;
}
