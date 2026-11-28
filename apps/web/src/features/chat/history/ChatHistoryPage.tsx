import { Button, NativeSelect, Select, TextInput, UnstyledButton } from '@mantine/core';
import { useUnit } from 'effector-react';
import { Globe, MessageSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { DiscardChangesDialog } from '../../../shared/dialogs/DiscardChangesDialog';
import { useI18n } from '../../../shared/i18n/i18n';
import { LibraryPagination } from '../../../shared/library/LibraryControls';
import { LibraryAvatar } from '../../../shared/library/LibraryItem';
import library from '../../../shared/library/Library.module.css';
import { RealmLink } from '../../realms/RealmLink';
import { useRealmNavigation } from '../../realms/useRealmNavigation';
import { ChatActions } from '../ChatActions';
import { ChatManagementDialog } from '../ChatManagementDialog';
import { $chatId, $chatLocked, chatLogOpenRequested, chatOpenRequested } from '../model';
import {
  $historyCriteria, $historyPage, $historyState, historyClosed, historyCriteriaChanged, historyFiltersReset,
  historyOpened, historyPageChanged, historyPageSize, historyRetryRequested, historySorts, historyWithoutRealm,
} from './model';
import classes from './ChatHistoryPage.module.css';

export default function ChatHistoryPage() {
  const { t, locale, number, plural } = useI18n();
  const { state, criteria, page, enter, leave, retry, change, reset, changePage, activeChatId, chatLocked, openChat, openLog } = useUnit({
    state: $historyState, criteria: $historyCriteria, page: $historyPage, enter: historyOpened, leave: historyClosed,
    retry: historyRetryRequested, change: historyCriteriaChanged, reset: historyFiltersReset, changePage: historyPageChanged,
    activeChatId: $chatId, chatLocked: $chatLocked, openChat: chatOpenRequested, openLog: chatLogOpenRequested,
  });
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const resultCount = useRef<HTMLOutputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const realms = useRealmNavigation();

  useEffect(() => {
    enter();
    return leave;
  }, [enter, leave]);

  function goToChat(id: string, tab: 'chat' | 'log' = 'chat') {
    (tab === 'log' ? openLog : openChat)(id);
    window.location.assign('#chat');
  }

  return <>
    <header className="page-heading">
      <h1 tabIndex={-1}>{t('chatHistory.label')}</h1>
    </header>
    <div className={library['library-panel']}>
      <div className={library['library-toolbar']}>
        <TextInput ref={search} type="search" aria-label={t('chatHistory.search')} placeholder={t('chatHistory.searchPlaceholder')}
          leftSection={<Search size={16} aria-hidden="true" />} value={criteria.q}
          onChange={(event) => change({ q: event.currentTarget.value })} />
        <div className={`${library['library-toolbar-options']} ${classes.options}`}>
          <NativeSelect aria-label={t('chatHistory.sort')} value={criteria.sort}
            data={historySorts.map((value) => ({ value, label: t(`chatHistory.sort.${value}`) }))}
            onChange={(event) => change({ sort: event.currentTarget.value as typeof criteria.sort })} />
          <Select aria-label={t('chatHistory.worldFilter')} placeholder={t('chatHistory.findWorld')} value={criteria.realm || null} disabled={!page}
            searchable clearable limit={60} nothingFoundMessage={t('realms.noResults')}
            clearButtonProps={{ 'aria-label': t('chatHistory.clearWorldFilter'), 'aria-hidden': false, tabIndex: 0 }}
            data={[
              { value: historyWithoutRealm, label: t('chatHistory.noWorld') },
              ...(page?.worlds ?? []),
            ]} onChange={(value) => change({ realm: value ?? '' })} />
        </div>
      </div>
      <div className={library['library-results']} aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <output className={library['library-message']}>{t('chatHistory.loading')}</output>}
        {state.status === 'error' && <div className={`${library['library-message']} ${library['library-state']}`}>
          <p className={classes.error} role="alert">{t(`error.${state.code}`)}</p>
          <Button variant="default" onClick={retry}>{t('common.retryLoad')}</Button>
        </div>}
        {page?.total === 0 && <div className={`${library['library-message']} ${library['library-state']}`}>
          <h2>{t(page.narrowed ? 'chatHistory.noResults' : 'home.noChats')}</h2>
          {page.narrowed ? <Button variant="default" onClick={reset}>{t('realms.resetSearch')}</Button>
            : <Button component="a" href="#chat">{t('home.startChat')}</Button>}
        </div>}
        {page && page.total > 0 && <>
          <output className={classes.count} ref={resultCount} tabIndex={-1}>
            {t(`chatHistory.count.${plural.select(page.total)}`, { count: number.format(page.total) })}
          </output>
          <ul className={classes.list} aria-label={t('chatHistory.label')}>
            {page.items.map((chat) => {
              const { id, title, realmId, realmTitle, realmHasAvatar, updatedAt, lastMessage } = chat;
              const name = title || t('chat.untitled');
              return <li className={classes.row} key={id}>
                <LibraryAvatar className={classes.avatar} lazy placeholder={realmId ? <Globe size={16} /> : <MessageSquare size={16} />}
                  src={realmId && realmHasAvatar ? `/api/realms/${encodeURIComponent(realmId)}/avatar` : undefined} />
                <div className={classes.copy}>
                  <UnstyledButton className={classes.title} type="button" dir="auto" aria-label={t('chatHistory.openNamed', { name })}
                    disabled={chatLocked && id !== activeChatId} onClick={() => goToChat(id)}>{name}</UnstyledButton>
                  {lastMessage && <p className={classes.preview} dir="auto">{lastMessage}</p>}
                  {realmId && realmTitle ? <RealmLink className={classes.realm} title={realmTitle}
                    disabled={realms.disabled(realmId)} onClick={() => realms.open(realmId)} />
                    : <span className={classes.noWorld}>{t('chatHistory.noWorld')}</span>}
                </div>
                <time className={classes.updated} dateTime={new Date(updatedAt).toISOString()}>{date.format(updatedAt)}</time>
                <div className={classes.actions}>
                  <ChatActions chat={chat} surface="history" locked={chatLocked} onOpenLog={() => goToChat(id, 'log')} />
                </div>
              </li>;
            })}
          </ul>
          <LibraryPagination label={t('chatHistory.pagination')} offset={page.offset} visible={page.items.length}
            total={page.total} pageSize={historyPageSize} onPage={(offset) => { changePage(offset); resultCount.current?.focus(); }} />
        </>}
      </div>
    </div>
    <ChatManagementDialog surface="history" onExit={() => {
      if (document.activeElement === document.body) search.current?.focus({ preventScroll: true });
    }} />
    <DiscardChangesDialog {...realms.confirmation} />
  </>;
}
