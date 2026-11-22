import { useI18n } from '../../shared/i18n/i18n';
import { Button, Group, Modal, Tabs, useComputedColorScheme } from '@mantine/core';
import { createWatch } from 'effector';
import { useProvidedScope, useUnit } from 'effector-react';
import { Bot, List, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chatActivityView } from './ChatActivity';
import { AgentToolbar, ChatAgents } from './ChatAgents';
import { ChatComposer } from './ChatComposer';
import { ChatLog } from './ChatLog';
import { ChatMenu } from './ChatMenu';
import { ChatHistory, type ChatHistoryHandle } from './ChatHistory';
import { ChatMessage, ChatPicture } from './ChatMessage';
import { $activeSession } from '../../platform/session/model';
import { chatDisplayStyle } from './chatDisplayStyle';
import type { ChatImage, Message } from './message';
import {
  $activeSubagents, $chatAnnouncement, $chatRows, $expandedReasoning, $messageEditor, $replyId, $replyPhase,
  $chatActivity, $chatGmMode, $chatId, $chatLoadError, $chatLoading, $chatLocked, $chatMessages, $chatSaveError,
  chatLoadRetryRequested, chatSaveRetryRequested,
  chatHidden, chatShown, keepHistoryAtEndRequested, messageDeleteRequested, messageEditCancelled,
  messageEditChanged, messageEditRequested, messageEditSubmitted, messageSent, reasoningToggled,
} from './model';
import { $appliedChatSettings } from './settings/model';
import './chat.css';

type Preview = { kind: 'preview'; image: ChatImage };
type Delete = { kind: 'delete'; message: Message };

export default function Chat() {
  const { t } = useI18n();
  const scheme = useComputedColorScheme('light');
  const [dialog, setDialog] = useState<Preview | Delete>();
  const [tab, setTab] = useState<string | null>('chat');
  const [agentView, setAgentView] = useState<{ chatId: string; key: string; showLog: boolean }>();
  const scope = useProvidedScope();
  const {
    session, settings, rows, replyId, replyPhase, activeSubagents, announcement, editor, expandedReasoning, show, hide, openEditor,
    changeDraft, closeEditor, saveEdit, remove, toggleReasoning,
    activity, messages, chatId, gmMode, loading, locked, loadError, saveError, retryLoad, retrySave,
  } = useUnit({
    session: $activeSession, settings: $appliedChatSettings,
    rows: $chatRows, replyId: $replyId, replyPhase: $replyPhase, activeSubagents: $activeSubagents, announcement: $chatAnnouncement,
    editor: $messageEditor, expandedReasoning: $expandedReasoning, show: chatShown, hide: chatHidden,
    openEditor: messageEditRequested, changeDraft: messageEditChanged, closeEditor: messageEditCancelled,
    saveEdit: messageEditSubmitted, remove: messageDeleteRequested, toggleReasoning: reasoningToggled,
    activity: $chatActivity, messages: $chatMessages, chatId: $chatId, gmMode: $chatGmMode,
    loading: $chatLoading, locked: $chatLocked, loadError: $chatLoadError, saveError: $chatSaveError,
    retryLoad: chatLoadRetryRequested, retrySave: chatSaveRetryRequested,
  });
  const username = session?.user.username ?? '';
  const title = useRef<HTMLHeadingElement>(null);
  const chatTab = useRef<HTMLButtonElement>(null);
  const agentHeading = useRef<HTMLHeadingElement>(null);
  const history = useRef<ChatHistoryHandle>(null);
  const jumpOnSend = useRef(false);
  const focusAfterDelete = useRef(false);
  const { entries, agents } = useMemo(() => chatActivityView(activity, messages), [activity, messages]);
  const activeTab = tab === 'agents' && !agents.length ? 'chat' : tab;
  const currentAgentView = agentView?.chatId === chatId ? agentView : undefined;
  const agent = currentAgentView && agents.find(({ key }) => key === currentAgentView.key);
  const showAgentLog = currentAgentView?.showLog ?? false;
  const selectAgent = useCallback((key?: string) => {
    setAgentView(key === undefined ? undefined : { chatId, key, showLog: false });
    setTab('agents');
  }, [chatId]);

  useEffect(() => {
    if (tab !== activeTab && document.activeElement === document.body) chatTab.current?.focus({ preventScroll: true });
  }, [tab, activeTab]);

  const openDelete = useCallback((message: Message) => setDialog({ kind: 'delete', message }), []);
  const openPreview = useCallback((image: ChatImage) => setDialog({ kind: 'preview', image }), []);
  const setReasoningOpen = useCallback((id: number, open: boolean) => toggleReasoning({ id, open }), [toggleReasoning]);
  const updateMessageDraft = useCallback((id: number, text: string) => changeDraft({ id, text }), [changeDraft]);
  const renderMessage = useCallback((message: Message) => (
    <ChatMessage message={message} username={username} phase={message.id === replyId && replyPhase ? replyPhase : undefined} locked={locked}
      activeSubagents={message.id === replyId ? activeSubagents : undefined}
      editor={editor?.id === message.id ? editor : undefined}
      reasoningOpen={expandedReasoning.has(message.id)} onToggleReasoning={setReasoningOpen}
      onEdit={openEditor} onDraftChange={updateMessageDraft} onCancelEdit={closeEditor} onSaveEdit={saveEdit}
      onDelete={openDelete} onPreview={openPreview} />
  ), [username, replyId, replyPhase, activeSubagents, locked, editor, expandedReasoning, setReasoningOpen, openEditor, updateMessageDraft,
    closeEditor, saveEdit, openDelete, openPreview]);

  useEffect(() => {
    if (!scope) return;
    const unwatchScroll = createWatch({ unit: keepHistoryAtEndRequested, scope, fn: () => history.current?.keepEndInView() });
    const unwatchSend = createWatch({ unit: messageSent, scope, fn: () => { jumpOnSend.current = true; } });
    show();
    return () => {
      unwatchScroll();
      unwatchSend();
      hide();
    };
  }, [scope, show, hide]);

  useLayoutEffect(() => {
    if (!jumpOnSend.current) return;
    jumpOnSend.current = false;
    history.current?.scrollToEnd();
  }, [replyId]);

  function removeMessage(message: Message) {
    focusAfterDelete.current = true;
    remove(message.id);
    setDialog(undefined);
  }

  return (
    <Tabs className="chat-panel" data-user-side={settings.userSide} value={activeTab} onChange={setTab}
      keepMountedMode="display-none" variant="unstyled" style={chatDisplayStyle(settings, scheme)}>
      <h1 className="chat-sr-only" id="chat-title" ref={title} tabIndex={-1}>{t('chat.title')}</h1>
      <header className="chat-workspace-header">
        <Tabs.List className="chat-tabs" aria-labelledby="chat-title">
          <Tabs.Tab ref={chatTab} className="chat-tab" value="chat" leftSection={<MessageSquare size={15} aria-hidden="true" />}>
            {t('chat.title')}
          </Tabs.Tab>
          <Tabs.Tab className="chat-tab" value="log" leftSection={<List size={16} aria-hidden="true" />}>
            {t('chat.log')}
          </Tabs.Tab>
          {agents.length > 0 && (
            <Tabs.Tab className="chat-tab" value="agents" leftSection={<Bot size={16} aria-hidden="true" />}>
              {t('chat.agents')}
            </Tabs.Tab>
          )}
        </Tabs.List>
        {activeTab === 'agents' && agent && (
          <AgentToolbar agent={agent} heading={agentHeading} showLog={showAgentLog}
            onBack={() => selectAgent(agent.parentKey)}
            onToggleLog={() => setAgentView((view) => view && { ...view, showLog: !view.showLog })} />
        )}
      </header>
      {(loadError || saveError) && (
        <div className="chat-status">
          <p role="alert">{t(`error.${loadError ?? saveError!}`)}</p>
          <Button type="button" size="compact-sm" variant="default" disabled={loading} onClick={loadError ? retryLoad : retrySave}>
            {t(loadError || saveError === 'chat_conflict' ? 'common.retryLoad' : 'chat.retrySave')}
          </Button>
        </div>
      )}
      <Tabs.Panel className="chat-conversation" value="chat">
        {rows.length ? (
          <ChatHistory key={chatId} ref={history} messages={rows} renderMessage={renderMessage} />
        ) : <p className="chat-empty">{loading ? t('chat.loading') : chatId && t('chat.empty')}</p>}
        <ChatComposer menu={<ChatMenu hasMessages={Boolean(rows.length)} scrollToStart={() => history.current?.scrollToStart()}
          scrollToEnd={() => history.current?.scrollToEnd()} />} />
      </Tabs.Panel>
      <Tabs.Panel className="chat-log-pane" value="log">
        <ChatLog key={chatId} entries={entries} messages={messages} gmMode={gmMode} onOpenAgent={selectAgent}
          liveReply={activeTab === 'log' && replyId !== null ? rows.at(-1) : undefined} />
      </Tabs.Panel>
      {agents.length > 0 && (
        <Tabs.Panel className="chat-agents-pane" value="agents">
          <ChatAgents key={chatId} agents={agents} agent={agent} heading={agentHeading} showLog={showAgentLog} onSelect={selectAgent} />
        </Tabs.Panel>
      )}
      <output className="chat-sr-only">{announcement && t(announcement)}</output>

      <Modal opened={Boolean(dialog)} onClose={() => setDialog(undefined)} onExitTransitionEnd={() => {
        if (!focusAfterDelete.current) return;
        focusAfterDelete.current = false;
        if (history.current) history.current.focus();
        else title.current?.focus({ preventScroll: true });
      }}
        title={dialog?.kind === 'delete' ? t('chat.deleteMessage') : t('chat.image')}
        size={dialog?.kind === 'preview' ? 'xl' : 'md'} centered closeButtonProps={{ 'aria-label': t('common.close') }}>
        {dialog?.kind === 'preview' && <div className="chat-preview"><ChatPicture image={dialog.image} /></div>}
        {dialog?.kind === 'delete' && (
          <>
            <p>{t('chat.deleteWarning')}</p>
            <Group justify="flex-end" mt="md">
              <Button type="button" variant="default" data-autofocus onClick={() => setDialog(undefined)}>{t('common.cancel')}</Button>
              <Button type="button" color="red" disabled={locked} onClick={() => removeMessage(dialog.message)}>{t('common.delete')}</Button>
            </Group>
          </>
        )}
      </Modal>
    </Tabs>
  );
}
