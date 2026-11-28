import { Menu } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ArrowDownToLine, ArrowUpToLine, BookOpen, ChevronRight, List, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { TemplateGuideModal } from '../../shared/prompt-templates/TemplateHelp';
import {
  $chatGmMode, $chatId, $chatLocked, $chatTitle, $unlinkedChat,
  chatCreateRequested, chatGmModeChanged, chatManagementDialogOpened, chatOpenRequested,
} from './model';
import chatClasses from './Chat.module.css';

export function ChatMenu({ hasMessages, scrollToStart, scrollToEnd }: {
  hasMessages: boolean; scrollToStart: () => void; scrollToEnd: () => void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const [guideOpened, setGuideOpened] = useState(false);
  const {
    id, title, locked, gmMode, unlinkedChat, create, open, changeGmMode, show,
  } = useUnit({
    id: $chatId, title: $chatTitle, locked: $chatLocked, gmMode: $chatGmMode, unlinkedChat: $unlinkedChat,
    create: chatCreateRequested, open: chatOpenRequested, changeGmMode: chatGmModeChanged, show: chatManagementDialogOpened,
  });
  return (
    <>
      <Menu position="top-start" shadow="sm" width={248} withinPortal>
        <Menu.Target>
          <button ref={trigger} type="button" className={['icon-button', chatClasses['chat-menu-button']].join(' ')} aria-label={t('chat.menu')} title={t('chat.menu')}>
            <List size={20} aria-hidden="true" />
          </button>
        </Menu.Target>
        <Menu.Dropdown aria-label={t('chat.menu')}>
          {id && <Menu.Label className={chatClasses['chat-menu-title']}><bdi>{title || t('chat.untitled')}</bdi></Menu.Label>}
          <Menu.Item leftSection={<Plus size={16} aria-hidden="true" />} disabled={locked} onClick={create}>{t('chat.new')}</Menu.Item>
          <Menu.Item leftSection={<List size={16} aria-hidden="true" />} onClick={() => show({ kind: 'list' })}>{t('chat.savedChats')}</Menu.Item>
          {unlinkedChat && <Menu.Item leftSection={<ChevronRight size={16} aria-hidden="true" />} disabled={locked}
            onClick={() => open(unlinkedChat.id)}>{t('chat.openUnlinked')}</Menu.Item>}
          <Menu.Divider />
          <Menu.CheckboxItem checked={gmMode} onChange={changeGmMode} disabled={!id || locked}
            title={t('chat.gmModeDescription')}>{t('chat.gmMode')}</Menu.CheckboxItem>
          {hasMessages && (
            <>
              <Menu.Divider />
              <Menu.Item leftSection={<ArrowUpToLine size={16} aria-hidden="true" />} onClick={scrollToStart}>{t('chat.historyStart')}</Menu.Item>
              <Menu.Item leftSection={<ArrowDownToLine size={16} aria-hidden="true" />} onClick={scrollToEnd}>{t('chat.historyEnd')}</Menu.Item>
            </>
          )}
          <Menu.Divider />
          <Menu.Item leftSection={<BookOpen size={16} aria-hidden="true" />} aria-haspopup="dialog" onClick={() => setGuideOpened(true)}>
            {t('templates.guideTitle')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <TemplateGuideModal scope="chat" opened={guideOpened} onClose={() => setGuideOpened(false)}
        onExitTransitionEnd={() => trigger.current?.focus({ preventScroll: true })} />

    </>
  );
}
