import type { JsonObject } from '@kuroko/contracts/llm';
import type { ToolId } from '@kuroko/contracts/tools';
import { CircleCheck, Dices, History, Radio, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../../shared/i18n/i18n';
type ToolDefinition = {
  icon: LucideIcon;
  label: MessageKey;
  description: MessageKey;
  parameters: readonly { name: string; description: MessageKey }[];
  example: JsonObject;
};

export const tools: Record<ToolId, ToolDefinition> = {
  roll_dice: {
    icon: Dices,
    label: 'tools.dice',
    description: 'tools.diceDescription',
    parameters: [
      { name: 'rolls', description: 'tools.diceRolls' },
      { name: 'purpose', description: 'tools.dicePurpose' },
      { name: 'details', description: 'tools.diceDetails' },
    ],
    example: { rolls: { attack: '2d20kh1 + 5', hit: '$attack >= 15', damage: 'if($hit, 2d6! + 3, 0)' } },
  },
  resolveCheck: {
    icon: CircleCheck,
    label: 'tools.check',
    description: 'tools.checkDescription',
    parameters: [
      { name: 'profile', description: 'tools.checkProfile' },
      { name: 'sides', description: 'tools.checkSides' },
      { name: 'target', description: 'tools.checkTarget' },
      { name: 'modifier', description: 'tools.checkModifier' },
      { name: 'mode', description: 'tools.checkMode' },
      { name: 'damage', description: 'tools.checkDamage' },
      { name: 'purpose', description: 'tools.dicePurpose' },
      { name: 'details', description: 'tools.diceDetails' },
    ],
    example: { profile: 'attack', sides: 12, target: 9, modifier: 2, mode: 'advantage', damage: { normal: 'd6 + 3', critical: '2d6 + 3' } },
  },
  getRollDetails: {
    icon: History,
    label: 'tools.rollDetails',
    description: 'tools.rollDetailsDescription',
    parameters: [{ name: 'rollIds', description: 'tools.rollDetailsIds' }],
    example: { rollIds: ['roll-id'] },
  },
  test_echo: {
    icon: Radio,
    label: 'tools.echo',
    description: 'tools.echoDescription',
    parameters: [{ name: 'text', description: 'tools.echoText' }],
    example: { text: 'ping' },
  },
};
