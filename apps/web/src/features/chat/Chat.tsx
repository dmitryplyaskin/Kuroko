import { useI18n } from '../../shared/i18n/i18n';
import { Anchor, Button, Group, Modal, Tabs, useComputedColorScheme } from '@mantine/core';
import { createWatch } from 'effector';
import { useProvidedScope, useUnit } from 'effector-react';
import { Bot, List, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { chatActivityView } from './ChatActivity';
import { AgentConversation, AgentToolbar, ChatAgents } from './ChatAgents';
import { ChatComposer } from './ChatComposer';
import { ChatLog, ChatLogView } from './ChatLog';
import { agentLogTurns } from './chatLogActivity';
import { ChatMenu } from './ChatMenu';
import { ChatActions } from './ChatActions';
import { ChatManagementDialog } from './ChatManagementDialog';
import { ChatHistory, type ChatHistoryHandle } from './ChatHistory';
import { ChatMessage, ChatPicture } from './ChatMessage';
import { $activeSession } from '../../platform/session/model';
import { DiscardChangesDialog } from '../../shared/dialogs/DiscardChangesDialog';
import { personaAvatarUrl } from '../personas/requests';
import { $selectedPersona, personaSelectionOpened } from '../personas/selectionModel';
import { useRealmNavigation } from '../realms/useRealmNavigation';
import { chatDisplayStyle } from './chatDisplayStyle';
import type { ChatImage, Message } from './message';
import {
  $activeSubagents, $chatAnnouncement, $chatRows, $chatVisible, $expandedReasoning, $messageEditor, $replyId, $replyPhase,
  $chatActivity, $chatEntry, $chatGmMode, $chatId, $chatLoadError, $chatLoading, $chatLocked, $chatMissing, $chatMessages, $chatRealm, $chatRegenerateId, $chatReplyVariants, $chatSaveError, $chatSummary,
  chatLoadRetryRequested, chatLogOpenRequested, chatSaveRetryRequested, type ChatEntry,
  chatHidden, chatShown, keepHistoryAtEndRequested, messageDeleteRequested, messageEditCancelled,
  messageEditChanged, messageEditRequested, messageEditSubmitted, messageRegenerateRequested, messageSent, reasoningToggled, replyVariantRequested,
} from './model';
import { $appliedChatSettings } from './settings/model';
import chatClasses from './Chat.module.css';
import logClasses from './ChatLog.module.css';

type Preview = { kind: 'preview'; image: ChatImage };
type Delete = { kind: 'delete'; message: Message };

export default function Chat() {
  const { t } = useI18n();
  const scheme = useComputedColorScheme('light');
  const [dialog, setDialog] = useState<Preview | Delete>();
  const [selectedTab, setSelectedTab] = useState<{ entry: ChatEntry | null; value: string | null }>();
  const [agentView, setAgentView] = useState<{ entry: ChatEntry | null; key: string }>();
  const scope = useProvidedScope();
  const realms = useRealmNavigation();
  const {
    session, settings, rows, replyId, replyPhase, activeSubagents, announcement, editor, expandedReasoning, show, hide, openEditor,
    changeDraft, closeEditor, saveEdit, remove, regenerateId, requestRegeneration, variants, selectVariant, toggleReasoning,
    activity, messages, chatId, chat, entry, openLog, realm, persona, readPersona, gmMode, loading, locked, loadError, saveError, missing, visible, retryLoad, retrySave,
  } = useUnit({
    session: $activeSession, settings: $appliedChatSettings,
    rows: $chatRows, replyId: $replyId, replyPhase: $replyPhase, activeSubagents: $activeSubagents, announcement: $chatAnnouncement,
    editor: $messageEditor, expandedReasoning: $expandedReasoning, show: chatShown, hide: chatHidden,
    openEditor: messageEditRequested, changeDraft: messageEditChanged, closeEditor: messageEditCancelled,
    saveEdit: messageEditSubmitted, remove: messageDeleteRequested, toggleReasoning: reasoningToggled,
    regenerateId: $chatRegenerateId, requestRegeneration: messageRegenerateRequested,
    variants: $chatReplyVariants, selectVariant: replyVariantRequested,
    activity: $chatActivity, messages: $chatMessages, chatId: $chatId, chat: $chatSummary, entry: $chatEntry, openLog: chatLogOpenRequested,
    realm: $chatRealm, gmMode: $chatGmMode,
    persona: $selectedPersona, readPersona: personaSelectionOpened,
    loading: $chatLoading, locked: $chatLocked, loadError: $chatLoadError, saveError: $chatSaveError, missing: $chatMissing, visible: $chatVisible,
    retryLoad: chatLoadRetryRequested, retrySave: chatSaveRetryRequested,
  });
  const username = persona?.name ?? session?.user.username ?? '';
  const userAvatar = persona?.hasAvatar ? personaAvatarUrl(persona.id, persona.revision) : undefined;
  const title = useRef<HTMLHeadingElement>(null);
  const chatTab = useRef<HTMLButtonElement>(null);
  const logTab = useRef<HTMLButtonElement>(null);
  const agentHeading = useRef<HTMLHeadingElement>(null);
  const history = useRef<ChatHistoryHandle>(null);
  const jumpOnSend = useRef(false);
  const focusAfterDelete = useRef(false);
  const { entries, agents } = useMemo(() => chatActivityView(activity, messages), [activity, messages]);
  const tab = selectedTab?.entry === entry ? selectedTab.value : entry?.tab ?? 'chat';
  const activeTab = tab === 'agents' && !agents.length ? 'chat' : tab;
  const currentAgentView = agentView?.entry === entry ? agentView : undefined;
  const agent = currentAgentView && agents.find(({ key }) => key === currentAgentView.key);
  const logVisible = visible && activeTab === 'log';
  const agentKey = agent?.key;
  const agentTasks = agent?.tasks;
  const agentTurns = useMemo(() => agentTasks ? agentLogTurns(agentTasks) : [], [agentTasks]);
  const selectAgent = useCallback((key: string) => {
    setAgentView({ entry, key });
    setSelectedTab({ entry, value: 'chat' });
  }, [entry]);

  function backFromAgent() {
    if (agent?.parentKey) {
      setAgentView({ entry, key: agent.parentKey });
    } else {
      setAgentView(undefined);
      (activeTab === 'log' ? logTab : chatTab).current?.focus({ preventScroll: true });
    }
  }

  useLayoutEffect(() => {
    if (agentKey) agentHeading.current?.focus({ preventScroll: true });
  }, [agentKey]);

  useEffect(() => {
    if (tab !== activeTab && document.activeElement === document.body) chatTab.current?.focus({ preventScroll: true });
  }, [tab, activeTab]);

  const openDelete = useCallback((message: Message) => setDialog({ kind: 'delete', message }), []);
  const openPreview = useCallback((image: ChatImage) => setDialog({ kind: 'preview', image }), []);
  const setReasoningOpen = useCallback((id: number, afterToolCallId: string | undefined, open: boolean) =>
    toggleReasoning({ id, afterToolCallId, open }), [toggleReasoning]);
  const updateMessageDraft = useCallback((id: number, index: number, text: string) => changeDraft({ id, index, text }), [changeDraft]);
  const regenerate = useCallback((id: number) => {
    history.current?.focus();
    requestRegeneration(id);
  }, [requestRegeneration]);
  const renderMessage = useCallback((message: Message) => (
    <ChatMessage message={message} username={username} userAvatar={userAvatar} realm={realm ?? undefined}
      phase={message.id === replyId && replyPhase ? replyPhase : undefined} locked={locked}
      activeSubagents={message.id === replyId ? activeSubagents : undefined}
      editor={editor?.id === message.id ? editor : undefined}
      expandedReasoning={expandedReasoning.get(message.id)} onToggleReasoning={setReasoningOpen}
      onEdit={openEditor} onDraftChange={updateMessageDraft} onCancelEdit={closeEditor} onSaveEdit={saveEdit}
      onRegenerate={message.id === regenerateId ? regenerate : undefined} variants={variants[message.id]} onSelectVariant={selectVariant}
      onDelete={openDelete} onPreview={openPreview} />
  ), [username, userAvatar, realm, replyId, replyPhase, activeSubagents, locked, editor, expandedReasoning, setReasoningOpen, openEditor, updateMessageDraft,
    closeEditor, saveEdit, regenerateId, regenerate, variants, selectVariant, openDelete, openPreview]);

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

  useEffect(() => {
    if (!session) return;
    readPersona();
    window.addEventListener('focus', readPersona);
    return () => window.removeEventListener('focus', readPersona);
  }, [session, readPersona]);

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
    <Tabs className={chatClasses['chat-panel']} data-user-side={settings.userSide} value={activeTab}
      onChange={(value) => setSelectedTab({ entry, value })}
      keepMountedMode="display-none" variant="unstyled" style={chatDisplayStyle(settings, scheme)}>
      <header className={chatClasses['chat-workspace-header']}>
        <div className={chat && !agent ? chatClasses['chat-context'] : chatClasses['chat-sr-only']}>
          <div className={chatClasses['chat-context-copy']}>
            <h1 dir="auto" id="chat-title" ref={title} tabIndex={-1}>{chat?.title || t('chat.title')}</h1>
            {realm && !agent && <Anchor component="button" type="button" size="sm" c="var(--kr-accent)" underline="always" dir="auto"
              disabled={realms.disabled(realm.id)} onClick={() => realms.open(realm.id)}>{realm.title}</Anchor>}
          </div>
          {chat && !agent && <ChatActions chat={chat} locked={locked} surface="chat" onOpenLog={() => openLog(chat.id)} />}
        </div>
        {agent && <AgentToolbar agent={agent} heading={agentHeading} onBack={backFromAgent} />}
        <Tabs.List className={chatClasses['chat-tabs']} aria-labelledby={agent ? 'chat-agent-title' : 'chat-title'}>
          <Tabs.Tab ref={chatTab} className={chatClasses['chat-tab']} value="chat" leftSection={<MessageSquare size={15} aria-hidden="true" />}>
            {t('chat.title')}
          </Tabs.Tab>
          <Tabs.Tab ref={logTab} className={chatClasses['chat-tab']} value="log" leftSection={<List size={16} aria-hidden="true" />}>
            {t('chat.log')}
          </Tabs.Tab>
          {!agent && agents.length > 0 && (
            <Tabs.Tab className={chatClasses['chat-tab']} value="agents" leftSection={<Bot size={16} aria-hidden="true" />}>
              {t('chat.agents')}
            </Tabs.Tab>
          )}
        </Tabs.List>
      </header>
      {(missing || loadError || saveError) && (
        <div className={chatClasses['chat-status']}>
          {missing && <p role="alert">{t('chat.deletedElsewhere')}</p>}
          {(loadError || saveError) && <>
            <p role="alert">{t(`error.${loadError ?? saveError!}`)}</p>
            <Button type="button" size="compact-sm" variant="default" disabled={loading} onClick={loadError ? retryLoad : retrySave}>
              {t(loadError || saveError === 'chat_conflict' ? 'common.retryLoad' : 'chat.retrySave')}
            </Button>
          </>}
        </div>
      )}
      <Tabs.Panel className={chatClasses['chat-conversation-pane']} value="chat">
        <div className={chatClasses['chat-conversation']} hidden={Boolean(agent)}>
          {rows.length ? (
            <ChatHistory key={chatId} ref={history} messages={rows} renderMessage={renderMessage} />
          ) : <p className={chatClasses['chat-empty']}>{loading ? t('chat.loading') : chatId && t('chat.empty')}</p>}
          <ChatComposer menu={<ChatMenu hasMessages={Boolean(rows.length)} scrollToStart={() => history.current?.scrollToStart()}
            scrollToEnd={() => history.current?.scrollToEnd()} />} />
        </div>
        {agent && <AgentConversation key={agent.key} agent={agent} turns={agentTurns} visible={activeTab === 'chat'} onSelect={selectAgent} />}
      </Tabs.Panel>
      <Tabs.Panel className={logClasses['chat-log-pane']} value="log">
        <div className={chatClasses['chat-primary-log']} hidden={Boolean(agent)}>
          <ChatLog key={chatId} chatId={chatId} visible={logVisible && !agent} entries={entries} messages={messages} gmMode={gmMode} onOpenAgent={selectAgent}
            liveReply={logVisible && !agent && replyId !== null ? rows.at(-1) : undefined} />
        </div>
        {agent && <ChatLogView key={agent.key} visible={logVisible} turns={logVisible ? agentTurns : []} emptyMessage={t('chat.logEmpty')} onOpenAgent={selectAgent} />}
      </Tabs.Panel>
      {!agent && agents.length > 0 && (
        <Tabs.Panel className={chatClasses['chat-agents-pane']} value="agents">
          <ChatAgents agents={agents} onSelect={selectAgent} />
        </Tabs.Panel>
      )}
      <output className={chatClasses['chat-sr-only']}>{announcement && t(announcement)}</output>

      <ChatManagementDialog surface="chat" />
      <DiscardChangesDialog {...realms.confirmation} />

      <Modal opened={Boolean(dialog)} onClose={() => setDialog(undefined)} onExitTransitionEnd={() => {
        if (!focusAfterDelete.current) return;
        focusAfterDelete.current = false;
        if (history.current) history.current.focus();
        else title.current?.focus({ preventScroll: true });
      }}
        title={dialog?.kind === 'delete' ? t('chat.deleteMessage') : t('chat.image')}
        size={dialog?.kind === 'preview' ? 'xl' : 'md'} centered closeButtonProps={{ 'aria-label': t('common.close') }}>
        {dialog?.kind === 'preview' && <div data-chat-preview><ChatPicture image={dialog.image} /></div>}
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
