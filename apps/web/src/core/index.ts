import { agentsModule } from '../features/agents/module';
import { chatModule } from '../features/chat/module';
import { connectionModule } from '../features/connection/module';
import { copyMessageTextModule } from '../features/copyMessageText/module';
import { homeModule } from '../features/home/module';
import { instructionsModule } from '../features/instructions/module';
import { personasModule } from '../features/personas/module';
import { realmsModule } from '../features/realms/module';
import { appearanceModule } from '../features/settings/appearanceModule';
import { settingsModule } from '../features/settings/module';
import { toolsModule } from '../features/tools/module';
import type { ModuleBundle } from '../modules/contracts';

export const corePlugin = {
  id: 'kuroko.core',
  modules: [homeModule, realmsModule, personasModule, chatModule, instructionsModule, toolsModule, agentsModule, copyMessageTextModule, settingsModule,
    appearanceModule, connectionModule],
  defaultScreen: 'kuroko.home.index',
  defaultSettingsTab: 'appearance',
  routeAliases: [
    { route: '#scenes', screen: 'kuroko.home.index' },
    { route: '#settings/connection', screen: 'kuroko.settings.index', settingsTab: 'connection' },
    { route: '#appearance', screen: 'kuroko.settings.index' },
    { route: '#secrets', screen: 'kuroko.settings.index', settingsTab: 'connection' },
  ],
} satisfies ModuleBundle;
