import { Fragment, type ReactNode } from 'react';
import { useI18n, type MessageKey } from './i18n';

export function LocalizedText({ id, values }: { id: MessageKey; values?: Readonly<Record<string, ReactNode>> }) {
  const { t } = useI18n();
  const text = t(id);
  if (!values) return text;
  return text.split(/(\{\w+\})/g).map((part, index) =>
    <Fragment key={index}>{index % 2 === 0 ? part : values[part.slice(1, -1)] ?? part}</Fragment>);
}
