import { agentsModule } from '../features/agents/module';
import { chatModule } from '../features/chat/module';
import { connectionModule } from '../features/connection/module';
import { copyMessageTextModule } from '../features/copyMessageText/module';
import { instructionsModule } from '../features/instructions/module';
import { personasModule } from '../features/personas/module';
import { realmsModule } from '../features/realms/module';
import { scenesModule } from '../features/scenes/module';
import { appearanceModule } from '../features/settings/appearanceModule';
import { settingsModule } from '../features/settings/module';
import { toolsModule } from '../features/tools/module';
import type { ModuleBundle } from '../modules/contracts';

export const corePlugin = {
  id: 'kuroko.core',
  modules: [scenesModule, realmsModule, personasModule, chatModule, instructionsModule, toolsModule, agentsModule, copyMessageTextModule, settingsModule,
    appearanceModule, connectionModule],
  defaultScreen: 'kuroko.scenes.index',
  defaultSettingsTab: 'appearance',
  routeAliases: [
    { route: '#appearance', screen: 'kuroko.settings.index' },
    { route: '#secrets', screen: 'kuroko.settings.index', settingsTab: 'connection' },
  ],
} satisfies ModuleBundle;
