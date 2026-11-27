import { personaRequestByteLimit } from '@kuroko/contracts/personas';
import { realmRequestByteLimit } from '@kuroko/contracts/realms';
import type { Database } from 'bun:sqlite';
import { json, Router } from 'express';
import { createAgentsRouter } from '../agents/agentsRouter';
import { createAgentsStore } from '../agents/agentsStore';
import { createAccountStore } from '../auth/accountStore';
import { createAuthRouter } from '../auth/authRouter';
import { createChatSettingsStore } from '../chat-settings/chatSettingsStore';
import { createChatSettingsRouter } from '../chat-settings/chatSettingsRouter';
import { createChatRouter } from '../chat/chatRouter';
import { createChatStore } from '../chat/chatStore';
import { createGmReply } from '../chat/gmReply';
import { createConnectionStore } from '../connection/connectionStore';
import { createConnectionRouter } from '../connection/connectionRouter';
import { createProviderConnections } from '../connection/providerConnections';
import { createProviderKeyStore } from '../connection/providerKeyStore';
import { createInstructionRouter } from '../instructions/instructionRouter';
import { createInstructionStore } from '../instructions/instructionStore';
import { createChatPrompt } from '../instructions/chatPrompt';
import { createPromptRenderer } from '../instructions/promptTemplate';
import { createLlmRouter } from '../llm/llmRouter';
import { createLlmService } from '../llm/llmService';
import { createPersonaRouter } from '../personas/personaRouter';
import { createPersonaStore } from '../personas/personaStore';
import { createRealmRouter } from '../realms/realmRouter';
import { createRealmStore } from '../realms/realmStore';
import { createDelegateTask, createSubagentToolDescriptions } from '../tools/delegateTask';
import { createToolsRouter } from '../tools/toolsRouter';
import { createToolsStore } from '../tools/toolsStore';

export function createApiRouter(db: Database, vaultKey: Buffer, secureCookie: boolean) {
  const router = Router();
  const { router: authRouter, requireUser } = createAuthRouter(createAccountStore(db), secureCookie);
  const keys = createProviderKeyStore(db, vaultKey);
  const presets = createConnectionStore(db, keys);
  const connections = createProviderConnections();
  const llm = createLlmService(presets, keys, connections);
  const chats = createChatStore(db);
  const realms = createRealmStore(db);
  const personas = createPersonaStore(db);
  const instructions = createInstructionStore(db);
  const renderPrompt = createPromptRenderer(realms.find, personas.find);
  const preparePrompt = createChatPrompt(instructions, renderPrompt);
  const worldExists = (userId: number, id: string) => realms.find(userId, id) !== null;
  const tools = createToolsStore(db);
  const agents = createAgentsStore(db);
  const delegateTask = createDelegateTask(llm, tools, agents, renderPrompt);
  const describeTools = createSubagentToolDescriptions(agents, tools, renderPrompt);

  router.use('/llm', requireUser, json({ limit: '4mb' }), createLlmRouter(llm, delegateTask, describeTools));
  router.use('/chats', requireUser, json({ limit: '8mb' }), createChatRouter(chats,
    createGmReply(chats, llm, tools.list, delegateTask, describeTools, preparePrompt)));
  router.use('/realms', requireUser, json({ limit: realmRequestByteLimit }), createRealmRouter(realms, personas.find));
  router.use('/personas', requireUser, json({ limit: personaRequestByteLimit }), createPersonaRouter(personas));
  router.use(json({ limit: '128kb' }));
  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  router.use('/auth', authRouter);
  router.use('/agents', requireUser, createAgentsRouter(agents, worldExists, renderPrompt));
  router.use('/settings/chat', requireUser, createChatSettingsRouter(createChatSettingsStore(db)));
  router.use('/settings/instructions', requireUser, createInstructionRouter(instructions, chats.find, worldExists, renderPrompt, preparePrompt));
  router.use('/settings/tools', requireUser, createToolsRouter(tools, presets.listPresets));
  router.use('/settings/connection', requireUser, createConnectionRouter(presets, keys, connections));

  return router;
}
