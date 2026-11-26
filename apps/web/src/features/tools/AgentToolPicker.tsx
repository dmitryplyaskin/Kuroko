import { ActionIcon, Checkbox, TextInput } from '@mantine/core';
import { agentToolIds, type AgentToolId } from '@kuroko/contracts/tools';
import { Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { tools } from './catalog';
import pickerClasses from './AgentToolPicker.module.css';

export function AgentToolPicker({ selected, disabled, issue, searchRef, onChange }: {
  selected: AgentToolId[];
  disabled: boolean;
  issue?: string;
  searchRef?: (input: HTMLInputElement | null) => void;
  onChange: (tools: AgentToolId[]) => void;
}) {
  const { t, locale, number } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const selectedFilter = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const chosen = new Set(selected);
  const terms = query.trim().normalize('NFKC').toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
  const matches = agentToolIds.flatMap((id) => {
    if (selectedOnly && !chosen.has(id)) return [];
    const name = t(tools[id].label);
    const description = t(tools[id].description);
    const text = `${name} ${id} ${description}`.normalize('NFKC').toLocaleLowerCase(locale);
    return terms.every((term) => text.includes(term)) ? [{ id, name, description }] : [];
  });

  function clearSearch() {
    setQuery('');
    if (list.current) list.current.scrollTop = 0;
    searchInput.current?.focus();
  }

  function toggle(id: AgentToolId, checked: boolean, input: HTMLInputElement, index: number) {
    onChange(checked ? [...selected, id] : selected.filter((tool) => tool !== id));
    if (selectedOnly && !checked && document.activeElement === input) {
      requestAnimationFrame(() => {
        const inputs = list.current?.querySelectorAll('input');
        (inputs?.[index] ?? inputs?.[index - 1] ?? selectedFilter.current)?.focus();
      });
    }
  }

  return <fieldset className={pickerClasses['tools-agent-picker']} disabled={disabled} aria-label={t('agents.allowedTools')}>
    <div className={pickerClasses['tools-agent-filters']}>
      <TextInput type="search" value={query} aria-label={t('agents.searchTools')} placeholder={t('agents.searchTools')} disabled={disabled}
        ref={(input) => { searchInput.current = input; searchRef?.(input); }}
        leftSection={<Search size={16} strokeWidth={1.5} aria-hidden="true" />}
        rightSection={query && <ActionIcon type="button" variant="subtle" color="gray" aria-label={t('tools.clearSearch')} onClick={clearSearch}>
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </ActionIcon>}
        onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
        onChange={(event) => { setQuery(event.currentTarget.value); if (list.current) list.current.scrollTop = 0; }} />
      <Checkbox ref={selectedFilter} label={t('agents.selectedOnly')} checked={selectedOnly} color="var(--kr-accent)"
        onChange={(event) => { setSelectedOnly(event.currentTarget.checked); if (list.current) list.current.scrollTop = 0; }} />
    </div>
    <output className={pickerClasses['tools-agent-count']}>
      {t('agents.toolCount', { count: number.format(selected.length), total: number.format(agentToolIds.length) })}
      {terms.length > 0 && <span>{t('agents.toolMatches', { count: number.format(matches.length) })}</span>}
    </output>
    {issue && <p className={pickerClasses['tools-agent-picker-error']} role="alert">{issue}</p>}
    {matches.length ? <ul ref={list} className={pickerClasses['tools-agent-results']}>
      {matches.map(({ id, name, description }, index) => <li key={id}>
        <Checkbox name="tools" value={id} checked={chosen.has(id)} color="var(--kr-accent)"
          label={<span className={pickerClasses['tools-agent-name']}>{name}<code>{id}</code></span>} description={description}
          onChange={({ currentTarget }) => toggle(id, currentTarget.checked, currentTarget, index)} />
      </li>)}
    </ul> : <p className={pickerClasses['tools-agent-empty']}>{t(terms.length ? 'tools.noResults' : 'agents.noSelectedTools')}</p>}
  </fieldset>;
}
