import type { MessageKey } from '../../shared/i18n/i18n';
import type { ExtensionContribution } from '../../modules/contracts';

export type MessageActionContext = Readonly<{ text: string }>;

declare module '../../modules/contracts' {
  interface ExtensionContributions {
    'chat.message.actions': {
      label: MessageKey;
      isVisible?: (message: MessageActionContext) => boolean;
      run: (message: MessageActionContext) => void | Promise<void>;
    };
  }
}

export type MessageAction = ExtensionContribution<'chat.message.actions'>;
