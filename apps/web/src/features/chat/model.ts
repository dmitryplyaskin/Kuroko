import type { MessageKey } from '../../shared/i18n/i18n';
import { combine, createEffect, createEvent, createStore, sample, scopeBind, type StoreValue } from 'effector';
import {
  chatReplyPrompt, readChatTitle, type ChatActivityEntry, type ChatActivityTurn, type ChatCreateRequest, type ChatReasoningBlock, type ChatReplyVariantSelection,
  type ChatReplyVariants, type ChatSnapshot, type ChatSummary, type ChatToolCall, type SavedChat,
} from '@kuroko/contracts/chat';
import type { ToolId } from '@kuroko/contracts/tools';
import { createChatActivity } from '@kuroko/tool-runtime/chatActivity';
import { abortFx } from '../../shared/async/abort';
import { newLocalId } from '../../shared/browser/id';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { inActiveSession, $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { $enabledTools, $toolSettingsReady } from '../tools/model';
import { chatApi, streamChatReply, type ChatReplyDelta } from './chatApi';
import { editMessageText, hasMessageContent, messageDraftTexts, type ActiveSubagent, type Message, type ReplyPhase } from './message';

type Generation = { session: ActiveSession; controller: AbortController; enabledTools: readonly ToolId[] };
type Reply = {
  generation: Generation;
  message: Message;
  activity: ChatActivityEntry[];
  replaceId?: number;
  activeSubagents?: readonly ActiveSubagent[];
  reasoningActive?: boolean;
};
type Navigation = { session: ActiveSession; action: 'initial' | 'create' | 'open'; id?: string; keepDraft?: boolean; realm?: ChatCreateRequest };
type Save = { session: ActiveSession; id: string; revision: number } & (
  (Omit<ChatSnapshot, 'revision'> & { reply?: Reply; draftToRecover?: string; selection?: never }) |
  { reply?: never; selection: ChatReplyVariantSelection }
);
type ChatManagement = { id: string; action: 'rename'; title: string } | { id: string; action: 'delete' };

export const chatShown = createEvent();
export const chatHidden = createEvent();
export const chatDraftChanged = createEvent<string>();
export const chatSendRequested = createEvent();
export const chatStopRequested = createEvent();
export const chatCreateRequested = createEvent();
export const realmChatCreateRequested = createEvent<string>();
export const chatOpenRequested = createEvent<string>();
type ManagementDialog = { kind: 'list' } | { kind: 'rename' | 'delete'; chat: ChatSummary };
const chatManagementRequested = createEvent<ChatManagement>();
export const chatManagementDialogOpened = createEvent<ManagementDialog>();
export const chatManagementDialogClosed = createEvent();
export const chatRenameChanged = createEvent<string>();
export const chatRenameSubmitted = createEvent();
export const chatDeleteConfirmed = createEvent();
export const chatLoadRetryRequested = createEvent();
export const chatSaveRetryRequested = createEvent();
export const chatGmModeChanged = createEvent<boolean>();
export const messageEditRequested = createEvent<number>();
export const messageEditChanged = createEvent<{ id: number; text: string; index?: number }>();
export const messageEditCancelled = createEvent();
export const messageEditSubmitted = createEvent<number>();
export const messageDeleteRequested = createEvent<number>();
export const messageRegenerateRequested = createEvent<number>();
export const replyVariantRequested = createEvent<ChatReplyVariantSelection>();
export const reasoningToggled = createEvent<{ id: number; afterToolCallId: string | undefined; open: boolean }>();

export const $chatVisible = createStore(false).on(chatShown, () => true).reset(chatHidden, sessionEnded);
const navigateFx = createEffect(async ({ session, action, id, realm }: Navigation) => {
  if (action === 'create') {
    const chats = realm ? await chatApi.list(session) : undefined;
    return { chat: await chatApi.create(session, realm), chats };
  }
  if (action === 'open' && id) return { chat: await chatApi.open(session, id) };
  const chats = await chatApi.list(session);
  const chat = chats[0] ? await chatApi.open(session, chats[0].id) : await chatApi.create(session);
  return { chat, chats };
});
const saveChatFx = createEffect((change: Save) => {
  const { session, id, revision } = change;
  if (change.selection) return chatApi.selectVariant(session, id, { revision, ...change.selection });
  const { messages, gmMode, activity, replaceId } = change;
  return chatApi.save(session, id, { revision, messages, gmMode, activity, replaceId });
});
const manageChatFx = createEffect(async ({ session, change }: { session: ActiveSession; current: string; change: ChatManagement }) => {
  if (change.action === 'rename') return { summary: await chatApi.rename(session, change.id, change.title) };
  try {
    await chatApi.remove(session, change.id);
  } catch (error) {
    // The delete may have succeeded before the connection dropped.
    if (!(error instanceof ApiError) || error.code !== 'chat_not_found') throw error;
  }
  return { deleted: change.id };
});
const chatOpened = inActiveSession(navigateFx.done, ({ session }) => session);
const openFailed = inActiveSession(navigateFx.fail, ({ session }) => session);
const saveSucceeded = inActiveSession(saveChatFx.done, ({ session }) => session);
const variantSelected = saveSucceeded.filter({ fn: ({ params }) => params.selection !== undefined });
const saveFailed = inActiveSession(saveChatFx.fail, ({ session }) => session);
const chatMissing = createEvent<{ id: string; draft?: string }>();
sample({
  clock: saveFailed,
  filter: ({ error }) => errorCode(error) === 'chat_not_found',
  fn: ({ params }) => ({ id: params.id, draft: 'draftToRecover' in params ? params.draftToRecover : undefined }),
  target: chatMissing,
});
const chatManagementSucceeded = inActiveSession(manageChatFx.done, ({ session }) => session);
const managementFailed = inActiveSession(manageChatFx.fail, ({ session }) => session);
const chatDeleted = chatManagementSucceeded.filterMap(({ result }) => result.deleted);
const activeChatDeleted = chatManagementSucceeded.filter({ fn: ({ params, result }) => result.deleted === params.current });

export const $chatManaging = createStore(false).on(manageChatFx, () => true)
  .reset(chatManagementSucceeded, managementFailed, sessionEnded);
export const $chatManagementError = createStore<ErrorCode | null>(null)
  .on(managementFailed, (_, { error }) => errorCode(error))
  .reset(manageChatFx, chatManagementDialogOpened, chatManagementDialogClosed, chatRenameChanged, sessionEnded);

const $saved = createStore<SavedChat | null>(null)
  .on(chatOpened, (_, { result }) => result.chat)
  .on(saveSucceeded, (_, { result }) => result)
  .on(chatManagementSucceeded, (chat, { result: { summary } }) => chat && summary?.id === chat.id ? { ...chat, ...summary } : chat)
  .reset(activeChatDeleted, chatMissing, sessionEnded);
export const $chatId = $saved.map((chat) => chat?.id ?? '');
export const $chatTitle = $saved.map((chat) => chat?.title ?? '');
export const $chatRealm = $saved.map((chat) => chat?.realm ?? null);
const $chatRealmId = $saved.map((chat) => chat?.realmId ?? null);
export const $chatGmMode = $saved.map((chat) => chat?.gmMode ?? false);
const noVariants: Record<number, ChatReplyVariants> = {};
export const $chatReplyVariants = $saved.map((chat) => chat?.replyVariants ?? noVariants);
export const $chats = createStore<ChatSummary[]>([])
  .on(chatOpened, (chats, { result }) => updateChatList(result.chats ?? chats, result.chat))
  .on(saveSucceeded, (chats, { result }) => updateChatList(chats, result))
  .on(chatManagementSucceeded, (chats, { result: { summary } }) => summary ? updateChatList(chats, summary) : chats)
  .on(chatDeleted, (chats, id) => chats.filter((chat) => chat.id !== id))
  .on(chatMissing, (chats, { id }) => chats.filter((chat) => chat.id !== id))
  .on(openFailed, (chats, { params, error }) => errorCode(error) === 'chat_not_found'
    ? chats.filter(({ id }) => id !== params.id) : chats)
  .reset(sessionEnded);

export const $savedChatList = combine($chats, $chatId, $chatRealmId, (chats, currentId, currentRealmId) =>
  currentId ? chats.filter(({ realmId }) => (realmId ?? null) === currentRealmId) : chats);
export const $unlinkedChat = combine($chats, $chatRealmId, (chats, realmId) =>
  realmId ? chats.find((chat) => !chat.realmId) ?? null : null);

function updateChatList(chats: ChatSummary[], { id, title, updatedAt, realmId }: ChatSummary) {
  return [{ id, title, updatedAt, ...(realmId && { realmId }) }, ...chats.filter((chat) => chat.id !== id)]
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

const $loadError = createStore<{ code: ErrorCode; params: Navigation } | null>(null)
  .on(openFailed, (_, { params, error }) => ({ params, code: errorCode(error) }))
  .reset(navigateFx, sessionEnded);
const $saveError = createStore<{ code: ErrorCode; params: Save } | null>(null)
  .on(saveFailed, (_, { params, error }) => ({ params, code: errorCode(error) }))
  .reset(chatMissing)
  .reset(saveChatFx, chatOpened, sessionEnded);

sample({ clock: [openFailed, saveFailed, managementFailed], fn: ({ params, error }) => ({ session: params.session, error }), target: protectedRequestFailed });

export const $chatLoadError = $loadError.map((failure) => failure?.code ?? null);
export const $chatMissing = createStore(false).on(chatMissing, () => true).reset(chatOpened, sessionEnded);
export const $chatSaveError = $saveError.map((failure) => failure?.code ?? null);
export const $chatLoading = createStore(false).on(navigateFx, () => true).reset(chatOpened, openFailed, sessionEnded);
const $saving = createStore(false).on(saveChatFx, () => true).reset(saveSucceeded, saveFailed, sessionEnded);

const $navigation = combine({ session: $activeSession, busy: $chatLoading, current: $chatId });
sample({
  clock: chatShown,
  source: { navigation: $navigation, missing: $chatMissing, failure: $loadError },
  filter: ({ navigation: { session, busy, current }, missing, failure }) => session !== null && !busy && !current && !missing && !failure,
  fn: ({ navigation: { session } }): Navigation => ({ session: session!, action: 'initial' }),
  target: navigateFx,
});
sample({
  clock: chatLoadRetryRequested,
  source: $loadError,
  filter: (failure) => failure !== null,
  fn: (failure) => failure!.params,
  target: navigateFx,
});
sample({
  clock: chatSaveRetryRequested,
  source: $saveError,
  filter: (failure) => failure !== null && failure.code !== 'chat_conflict',
  fn: (failure) => failure!.params,
  target: saveChatFx,
});
sample({
  clock: chatSaveRetryRequested,
  source: $saveError,
  filter: (failure) => failure?.code === 'chat_conflict',
  fn: (failure): Navigation => ({ session: failure!.params.session, action: 'open', id: failure!.params.id }),
  target: navigateFx,
});

const $messages = createStore<Message[]>([]).reset(sessionEnded);
const $activity = createStore<ChatActivityTurn[]>([])
  .on(chatOpened, (_, { result }) => result.chat.activity ?? [])
  .on(variantSelected, (_, { result }) => result.activity ?? [])
  .reset(sessionEnded);
const $reply = createStore<Reply | null>(null).reset(sessionEnded);
const $replaceId = $reply.map((reply) => reply?.replaceId ?? null);
export const $chatMessages = combine($messages, $replaceId, (messages, replaceId) =>
  replaceId !== null ? messages.slice(0, -1) : messages);
const $nextId = createStore(1)
  .on(chatOpened, (_, { result }) => (result.chat.messages.at(-1)?.id ?? 0) + 1)
  .reset(sessionEnded);
$messages
  .on(chatOpened, (_, { result }) => result.chat.messages)
  .on(variantSelected, (_, { result }) => result.messages);

export const $chatLocked = combine($chatLoading, $saving, $saveError, $reply, $chatManaging,
  (loading, saving, failure, reply, managing) => loading || saving || failure !== null || reply !== null || managing);

sample({
  clock: replyVariantRequested,
  source: { session: $activeSession, chat: $saved, visible: $chatVisible, locked: $chatLocked },
  filter: ({ session, chat, visible, locked }, { replyId, index }) => {
    const variant = chat?.replyVariants?.[replyId];
    return visible && !locked && session !== null && variant !== undefined &&
      Number.isSafeInteger(index) && index >= 0 && index < variant.total && index !== variant.index;
  },
  fn: ({ session, chat }, selection): Save => ({ session: session!, id: chat!.id, revision: chat!.revision, selection }),
  target: saveChatFx,
});

$messages.reset(activeChatDeleted, chatMissing);
$activity.reset(activeChatDeleted, chatMissing);
sample({
  clock: activeChatDeleted,
  source: $activeSession,
  filter: (session) => session !== null,
  fn: (session): Navigation => ({ session: session!, action: 'initial' }),
  target: navigateFx,
});

const $chatNavigation = combine($navigation, $chatLocked, (navigation, locked) => ({ ...navigation, locked }));
const initialManager = { dialog: undefined, draft: '', invalid: false };
export const $chatManager = createStore<{ dialog?: ManagementDialog; draft: string; invalid: boolean }>(initialManager)
  .on(chatManagementDialogOpened, (_, dialog) => ({ dialog, draft: dialog.kind === 'rename' ? dialog.chat.title : '', invalid: false }))
  .on(chatRenameChanged, (state, draft) => state.dialog?.kind === 'rename' ? { ...state, draft, invalid: false } : state)
  .on(chatManagementSucceeded, (state) => state.dialog
    ? { ...initialManager, dialog: { kind: 'list' } } : state)
  .reset(chatManagementDialogClosed, sessionEnded);

const rename = sample({
  clock: chatRenameSubmitted,
  source: { manager: $chatManager, locked: $chatLocked },
  filter: ({ manager, locked }) => !locked && manager.dialog?.kind === 'rename',
  fn: ({ manager }) => {
    const title = manager.draft.trim();
    return { id: (manager.dialog as { chat: ChatSummary }).chat.id, title, valid: Boolean(readChatTitle(title)) };
  },
});
$chatManager.on(rename, (state, { valid }) => ({ ...state, invalid: !valid }));
sample({
  clock: rename,
  filter: ({ valid }) => valid,
  fn: ({ id, title }): ChatManagement => ({ id, title, action: 'rename' }),
  target: chatManagementRequested,
});
sample({
  clock: chatDeleteConfirmed,
  source: $chatManager,
  filter: ({ dialog }) => dialog?.kind === 'delete',
  fn: ({ dialog }): ChatManagement => ({ id: (dialog as { chat: ChatSummary }).chat.id, action: 'delete' }),
  target: chatManagementRequested,
});

sample({
  clock: chatManagementRequested,
  source: { navigation: $chatNavigation, chats: $chats },
  filter: ({ navigation, chats }, change) => navigation.session !== null && !navigation.locked &&
    chats.some(({ id }) => id === change.id),
  fn: ({ navigation }, change) => ({ session: navigation.session!, current: navigation.current, change }),
  target: manageChatFx,
});
sample({
  clock: [chatCreateRequested.map(() => undefined), realmChatCreateRequested],
  source: { navigation: $chatNavigation, chat: $saved },
  filter: ({ navigation: { session, locked } }) => session !== null && !locked,
  fn: ({ navigation: { session, current }, chat }, requestedRealmId): Navigation => {
    const realmId = requestedRealmId ?? chat?.realmId;
    return {
      session: session!, action: 'create', keepDraft: !current && requestedRealmId === undefined,
      realm: realmId ? { realmId, id: newLocalId() } : undefined,
    };
  },
  target: navigateFx,
});
sample({
  clock: chatOpenRequested,
  source: $chatNavigation,
  filter: ({ session, locked, current }, id) => session !== null && !locked && id !== current,
  fn: ({ session, current }, id): Navigation => ({ session: session!, action: 'open', id, keepDraft: !current }),
  target: navigateFx,
});

export const $chatDraft = createStore('')
  .on(chatDraftChanged, (_, draft) => draft)
  .on(chatOpened, (draft, { params }) => params.action === 'initial' || params.keepDraft ? draft : '')
  .on(chatMissing, (draft, recovery) => recovery.draft && recovery.draft !== draft
    ? [recovery.draft, draft].filter(Boolean).join('\n\n') : draft)
  .reset(activeChatDeleted, sessionEnded);

const $composer = combine({
  session: $activeSession, visible: $chatVisible, draft: $chatDraft, locked: $chatLocked, chatId: $chatId, nextId: $nextId,
  enabledTools: $enabledTools, toolSettingsReady: $toolSettingsReady,
});
function canGenerate({ session, visible, locked, chatId, toolSettingsReady }: StoreValue<typeof $composer>) {
  return session !== null && visible && !locked && toolSettingsReady && Boolean(chatId);
}

function canSend(composer: StoreValue<typeof $composer>) {
  return canGenerate(composer) && Boolean(composer.draft.trim());
}

function createReply(session: ActiveSession, enabledTools: readonly ToolId[], id: number, time: number, replaceId?: number): Reply {
  return {
    generation: { session, controller: new AbortController(), enabledTools },
    message: { id, role: 'assistant', text: '', time },
    activity: [],
    replaceId,
  };
}

export const $chatCanSend = $composer.map(canSend);
export const messageSent = sample({
  clock: chatSendRequested,
  source: $composer,
  filter: canSend,
  fn: ({ session, nextId, draft, enabledTools }) => {
    const time = Date.now();
    const user: Message = { id: nextId, role: 'user', text: draft.trim(), time };
    const reply = createReply(session!, enabledTools, nextId + 1, time);
    return { user, reply, draftToRecover: draft };
  },
});
$messages.on(messageSent, (messages, { user }) => [...messages, user]);
$nextId.on(messageSent, (_, { reply }) => reply.message.id + 1);
$chatDraft.reset(messageSent);

const $regeneration = combine($saved, $composer, (chat, composer) => {
  if (!chat || !canGenerate(composer)) return null;
  const last = chat.messages.at(-1);
  const replaceId = last?.role === 'assistant' ? last.id : undefined;
  const prompt = chatReplyPrompt(chat.messages, replaceId);
  return last && prompt ? { chat, id: last.id, promptId: prompt.id, replaceId } : null;
});
export const $chatRegenerateId = $regeneration.map((target) => target?.id ?? null);
const replyRegenerated = sample({
  clock: messageRegenerateRequested,
  source: { target: $regeneration, composer: $composer },
  filter: ({ target }, id) => target?.id === id,
  fn: ({ target, composer }) => ({
    chat: target!.chat,
    reply: createReply(composer.session!, composer.enabledTools, target!.promptId + 1, Date.now(), target!.replaceId),
  }),
});
$nextId.on(replyRegenerated, (nextId, { reply }) => Math.max(nextId, reply.message.id + 1));

const replyDelta = createEvent<ChatReplyDelta & { generation: Generation }>();
const replyContentReceived = createEvent<{ generation: Generation; text: string; toolCalls: ChatToolCall[]; reasoningBlocks: ChatReasoningBlock[] }>();
const replySubagentActivity = createEvent<{ generation: Generation; active: readonly ActiveSubagent[] }>();
const replyActivityReceived = createEvent<{ generation: Generation; entry: ChatActivityEntry }>();
const generateReplyFx = createEffect(async ({ reply: { generation, replaceId }, chat }: { reply: Reply; chat: SavedChat }) => {
  if (chat.gmMode) return chatApi.gmReply(generation.session, chat, generation.controller.signal, replaceId);
  const publish = scopeBind(replyDelta, { safe: true });
  const report = scopeBind(replyContentReceived, { safe: true });
  const reportSubagent = scopeBind(replySubagentActivity, { safe: true });
  const log = scopeBind(replyActivityReceived, { safe: true });
  const onActivity = (entry: ChatActivityEntry) => log({ generation, entry });
  const start = createChatActivity(onActivity);
  const reply = start('reply', {});
  const { signal } = generation.controller;
  try {
    const history = replaceId === undefined ? chat.messages : chat.messages.slice(0, -1);
    const text = await streamChatReply(generation.session, chat.id, history, generation.enabledTools, signal,
      (delta) => publish({ generation, ...delta }), (text, toolCalls, reasoningBlocks) => report({ generation, text, toolCalls, reasoningBlocks }),
      (active) => reportSubagent({ generation, active }), start, onActivity, replaceId !== undefined || chat.replyVariants !== undefined, replaceId);
    reply.finish('completed', {});
    return text;
  } catch (error) {
    reply.finish(signal.aborted ? 'stopped' : 'failed', { error: errorCode(error) });
    throw error;
  }
});

const replyActivityUpdated = sample({
  clock: replyActivityReceived,
  source: $reply,
  filter: (reply, { generation }) => reply?.generation === generation,
  fn: (reply, { entry }): Reply => {
    const activity = [...reply!.activity];
    const index = activity.findIndex(({ id }) => id === entry.id);
    if (index < 0) activity.push(entry);
    else activity[index] = entry;
    return { ...reply!, activity };
  },
});
$reply.on(replyActivityUpdated, (_, reply) => reply);

function finishActivity(reply: Reply, status: 'completed' | 'failed' | 'stopped'): ChatActivityTurn | undefined {
  if (!reply.activity.length) return;
  const now = Date.now();
  return {
    promptId: reply.message.id - 1,
    entries: reply.activity.map((entry) => entry.status === 'running'
      ? { ...entry, status, duration: Math.max(0, now - entry.time) }
      : entry),
  };
}

const replyContentUpdated = sample({
  clock: replyContentReceived,
  source: $reply,
  filter: (reply, { generation }) => reply?.generation === generation,
  fn: (reply, { text, toolCalls, reasoningBlocks }): Reply => {
    const message = { ...reply!.message, text };
    if (reasoningBlocks.length) message.reasoningBlocks = reasoningBlocks;
    else delete message.reasoningBlocks;
    if (toolCalls.length) message.toolCalls = toolCalls;
    else delete message.toolCalls;
    return { ...reply!, reasoningActive: false, message };
  },
});
$reply.on(replyContentUpdated, (_, reply) => reply);

const replySubagentUpdated = sample({
  clock: replySubagentActivity,
  source: $reply,
  filter: (reply, { generation }) => reply?.generation === generation,
  fn: (reply, { active }): Reply => ({ ...reply!, activeSubagents: active }),
});
$reply.on(replySubagentUpdated, (_, reply) => reply);

const replyPrepared = saveSucceeded.filterMap(({ params, result }) => params.reply && { reply: params.reply, chat: result });
sample({
  clock: replyPrepared,
  filter: $chatVisible,
  target: generateReplyFx,
});
sample({ clock: replyRegenerated, target: generateReplyFx });
$reply.on(generateReplyFx, (_, { reply }) => reply);

const replyUpdated = sample({
  clock: replyDelta,
  source: $reply,
  filter: (reply, { generation, text }) => reply?.generation === generation && Boolean(text),
  fn: (reply, delta): Reply => {
    const message = reply!.message;
    if (delta.type === 'text_delta') return { ...reply!, reasoningActive: false, message: { ...message, text: message.text + delta.text } };
    const { afterToolCallId, text, textOffset } = delta;
    const reasoningBlocks = [...(message.reasoningBlocks ?? [])];
    const last = reasoningBlocks.at(-1);
    if (last && last.afterToolCallId === afterToolCallId) {
      reasoningBlocks[reasoningBlocks.length - 1] = { ...last, text: last.text + text };
    } else {
      reasoningBlocks.push({ text, textOffset, ...(afterToolCallId && { afterToolCallId }) });
    }
    return { ...reply!, reasoningActive: true, message: { ...message, reasoningBlocks } };
  },
});
$reply.on(replyUpdated, (_, reply) => reply);

const replyCompleted = sample({
  clock: inActiveSession(generateReplyFx.done, ({ reply }) => reply.generation.session),
  source: $reply,
  filter: (reply, { params }) => reply?.generation === params.reply.generation,
  fn: (reply, { result }) => {
    const { replaceId, message } = reply!;
    return typeof result === 'string'
      ? { replaceId, message: { ...message, text: result }, activity: finishActivity(reply!, 'completed'), saved: null }
      : { replaceId, message: result.messages.at(-1)!, activity: undefined, saved: result };
  },
});
const replyFailed = sample({
  clock: inActiveSession(generateReplyFx.fail, ({ reply }) => reply.generation.session),
  source: $reply,
  filter: (reply, { params }) => reply?.generation === params.reply.generation,
  fn: (reply, { error, params }) => ({
    replaceId: reply!.replaceId, message: reply!.message, error,
    session: params.reply.generation.session, activity: finishActivity(reply!, 'failed'),
  }),
});
sample({
  clock: replyFailed,
  source: { id: $chatId, messages: $messages },
  filter: ({ id }, { error }) => Boolean(id) && errorCode(error) === 'chat_not_found',
  fn: ({ id, messages }, { message }) => ({ id, draft: messages.find(({ id }) => id === message.id - 1)?.text }),
  target: chatMissing,
});
sample({ clock: replyFailed, fn: ({ session, error }) => ({ session, error }), target: protectedRequestFailed });

const replyStopped = sample({
  clock: [chatStopRequested, chatHidden],
  source: $reply,
  filter: (reply): reply is Reply => reply !== null,
  fn: (reply) => ({
    replaceId: reply!.replaceId, message: reply!.message, controller: reply!.generation.controller, activity: finishActivity(reply!, 'stopped'),
  }),
});

const replyPartial = sample({
  clock: [replyFailed.filter({ fn: ({ error }) => errorCode(error) !== 'chat_not_found' }), replyStopped],
  filter: ({ replaceId }) => replaceId === undefined,
  fn: ({ message, activity }) => {
    const partial = { ...message };
    const reasoningBlocks = partial.reasoningBlocks?.filter(({ text }) => text.trim())
      .map((block) => ({ ...block, text: block.text.toWellFormed() }));
    if (reasoningBlocks?.length) partial.reasoningBlocks = reasoningBlocks;
    else delete partial.reasoningBlocks;
    return { message: partial, activity, replaceId: undefined };
  },
});

function hasReplyContent(message: Message) {
  return Boolean(message.reasoning || message.reasoningBlocks?.length) || hasMessageContent(message);
}

sample({ clock: replyStopped, fn: ({ controller }) => controller, target: abortFx });
$reply.reset(replyCompleted, replyFailed, replyStopped);
$messages
  .on(replyCompleted, (messages, { message, saved, replaceId }) => {
    if (saved) return saved.messages;
    if (!hasReplyContent(message)) return messages;
    return [...(replaceId === undefined ? messages : messages.slice(0, -1)), message];
  })
  .on(replyPartial, (messages, { message }) => hasReplyContent(message) ? [...messages, message] : messages);
$saved.on(replyCompleted, (chat, { saved }) => saved ?? chat);
$chats.on(replyCompleted, (chats, { saved }) => saved ? updateChatList(chats, saved) : chats);
function withoutActivity(turns: ChatActivityTurn[], promptId: number) {
  return turns.some((turn) => turn.promptId === promptId) ? turns.filter((turn) => turn.promptId !== promptId) : turns;
}
$activity
  .on(replyCompleted, (turns, { message, activity, saved }) => {
    if (saved) return saved.activity ?? [];
    const history = withoutActivity(turns, message.id - 1);
    return activity ? [...history, activity] : history;
  })
  .on(replyPartial, (turns, { activity }) => activity ? [...withoutActivity(turns, activity.promptId), activity] : turns);
export const $replyId = $reply.map((reply) => reply?.message.id ?? null);
const $liveActivity = $reply.map((reply) => reply?.activity ?? null);
export const $chatActivity = combine($activity, $replyId, $liveActivity, (turns, replyId, entries) => {
  if (replyId === null) return turns;
  const promptId = replyId - 1;
  const history = withoutActivity(turns, promptId);
  return entries?.length ? [...history, { promptId, entries }] : history;
});

export const $chatError = createStore<ErrorCode | null>(null)
  .on(replyFailed, (_, { error }) => errorCode(error))
  .reset(messageSent, replyRegenerated, variantSelected, chatOpened, chatMissing, sessionEnded);

type Editor = { id: number; texts: string[] };
const editOpened = sample({
  clock: messageEditRequested,
  source: $messages,
  filter: $chatLocked.map((locked) => !locked),
  fn: (messages, id) => messages.find((message) => message.id === id),
}).filterMap((message) => message && { id: message.id, texts: messageDraftTexts(message) });

const $editor = createStore<Editor | null>(null)
  .on(editOpened, (editor, draft) => editor?.id === draft.id ? editor : draft)
  .on(messageEditChanged, (editor, { id, index = 0, text }) => editor?.id === id
    ? { id, texts: editor.texts.map((value, part) => part === index ? text : value) }
    : editor)
  .reset(messageEditCancelled, chatOpened, chatMissing, sessionEnded);

const $editorCandidate = combine($editor, $messages, $chatLocked, (editor, messages, locked) => {
  if (!editor) return null;
  const original = messages.find((message) => message.id === editor.id);
  if (locked || !original) return { ...editor, update: undefined };
  const draft = editMessageText(original, editor.texts);
  const changed = (draft.text || original.image) &&
    (draft.text !== original.text || draft.toolCalls !== original.toolCalls || draft.reasoningBlocks !== original.reasoningBlocks);
  return { ...editor, update: changed ? draft : undefined };
});
export const $messageEditor = $editorCandidate.map((editor) => editor && ({
  id: editor.id, texts: editor.texts, canSave: Boolean(editor.update),
}));
const messageEdited = sample({
  clock: messageEditSubmitted,
  source: $editorCandidate,
  fn: (editor, id) => editor?.id === id ? editor.update : undefined,
}).filterMap((message) => message);

const messageDeleted = sample({
  clock: messageDeleteRequested,
  source: { messages: $messages, locked: $chatLocked },
  filter: ({ messages, locked }, id) => !locked && messages.some((message) => message.id === id),
  fn: ({ messages }, id) => messages.find((message) => message.id === id),
}).filterMap((message) => message);

$messages
  .on(messageEdited, (messages, edited) => messages.map((message) => message.id === edited.id ? edited : message))
  .on(messageDeleted, (messages, { id }) => messages.filter((message) => message.id !== id));
$activity.on(messageDeleted, (turns, { id, role }) => turns.filter(({ promptId }) => promptId !== (role === 'user' ? id : id - 1)));
$editor
  .reset(messageEdited)
  .on(messageDeleted, (editor, { id }) => editor?.id === id ? null : editor)
  .reset(activeChatDeleted);

const historyChanged = createEvent<{ reply?: Reply; gmMode?: boolean; activity?: ChatActivityTurn; replaceId?: number; draftToRecover?: string }>();
sample({ clock: messageSent, fn: ({ reply, draftToRecover }) => ({ reply, draftToRecover }), target: historyChanged });
sample({ clock: [messageEdited, messageDeleted], fn: () => ({}), target: historyChanged });
sample({
  clock: chatGmModeChanged,
  source: { locked: $chatLocked, chat: $saved },
  filter: ({ locked, chat }, gmMode) => !locked && chat !== null && chat.gmMode !== gmMode,
  fn: (_, gmMode) => ({ gmMode }),
  target: historyChanged,
});
sample({
  clock: [replyCompleted.filter({ fn: ({ saved }) => !saved }), replyPartial],
  source: $messages,
  filter: (_, { message, activity }) => hasReplyContent(message) || Boolean(activity),
  fn: (messages, { message, activity, replaceId }) => ({
    activity, replaceId, draftToRecover: messages.find(({ id }) => id === message.id - 1)?.text,
  }),
  target: historyChanged,
});
sample({
  clock: historyChanged,
  source: { session: $activeSession, chat: $saved, messages: $messages },
  filter: ({ session, chat }) => session !== null && chat !== null,
  fn: ({ session, chat, messages }, { reply, gmMode, activity, replaceId, draftToRecover }): Save =>
    ({ session: session!, id: chat!.id, revision: chat!.revision, messages, reply, gmMode, activity, replaceId, draftToRecover }),
  target: saveChatFx,
});

export const $expandedReasoning = createStore<ReadonlyMap<number, ReadonlySet<string | undefined>>>(new Map())
  .on(reasoningToggled, (expanded, { id, afterToolCallId, open }) => {
    const blocks = new Set(expanded.get(id));
    if (blocks.has(afterToolCallId) === open) return expanded;
    if (open) blocks.add(afterToolCallId);
    else blocks.delete(afterToolCallId);
    const next = new Map(expanded);
    if (blocks.size) next.set(id, blocks);
    else next.delete(id);
    return next;
  })
  .on(messageDeleted, (expanded, { id }) => {
    if (!expanded.has(id)) return expanded;
    const next = new Map(expanded);
    next.delete(id);
    return next;
  })
  .reset(chatOpened, activeChatDeleted, chatMissing, sessionEnded);

export const $chatAnnouncement = createStore<MessageKey | null>(null)
  .on(generateReplyFx, () => 'chat.announcementAnswering')
  .on(replySubagentUpdated, (_, { activeSubagents }) => {
    const count = activeSubagents?.length ?? 0;
    if (count > 1) return 'chat.subagentsWorking';
    return count ? 'chat.subagentWorking' : 'chat.announcementAnswering';
  })
  .on(replyCompleted, () => 'chat.announcementReady')
  .reset(replyFailed)
  .on(replyStopped, () => 'chat.announcementStopped')
  .on(messageEdited, () => 'chat.announcementEdited')
  .on(messageDeleted, () => 'chat.announcementDeleted')
  .reset(chatOpened, sessionEnded);

export const $replyPhase = $reply.map((reply): ReplyPhase | null => {
  if (!reply) return null;
  if (reply.activeSubagents?.length) return 'subagent';
  return reply.reasoningActive ? 'reasoning' : 'answer';
});
const noSubagents: readonly ActiveSubagent[] = [];
export const $activeSubagents = $reply.map((reply) => reply?.activeSubagents ?? noSubagents);
export const $chatRows = combine($chatMessages, $reply, (messages, reply) => reply ? [...messages, reply.message] : messages);
export const keepHistoryAtEndRequested = sample({
  clock: [replyRegenerated, replyUpdated, replyContentUpdated, replySubagentUpdated, replyCompleted, replyFailed, replyStopped, messageEdited, variantSelected],
  fn: () => undefined,
});
