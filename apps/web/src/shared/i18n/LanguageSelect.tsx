import { NativeSelect } from '@mantine/core';
import { useUnit } from 'effector-react';
import { isLocale, localeChanged, locales, useI18n } from './i18n';

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const setLocale = useUnit(localeChanged);
  const label = t('locale.label');

  return (
    <NativeSelect label={compact ? undefined : label} aria-label={compact ? label : undefined}
      size={compact ? 'sm' : undefined} value={locale}
      data={locales.map((value) => ({ value, label: t(`locale.${value}`) }))}
      onChange={(event) => {
        const { value } = event.currentTarget;
        if (isLocale(value)) setLocale(value);
      }} />
  );
}
