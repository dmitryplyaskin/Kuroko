import type { AgentDraft } from '@kuroko/contracts/agents';
import { PromptTemplateError, type createPromptRenderer } from '../instructions/promptTemplate';

export function renderAgentDescription(
  render: ReturnType<typeof createPromptRenderer>, userId: number,
  { name, description, worldId }: Pick<AgentDraft, 'name' | 'description' | 'worldId'>,
): string | undefined {
  try {
    return render(userId, { agent: { name } }, worldId)(description).trim();
  } catch (error) {
    if (!(error instanceof PromptTemplateError)) throw error;
  }
}
