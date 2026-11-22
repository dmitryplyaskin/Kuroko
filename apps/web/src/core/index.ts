import { chatModule } from '../features/chat/module';
import { connectionModule } from '../features/connection/module';
import { copyMessageTextModule } from '../features/copyMessageText/module';
import { realmsModule } from '../features/realms/module';
import { scenesModule } from '../features/scenes/module';
import { appearanceModule } from '../features/settings/appearanceModule';
import { settingsModule } from '../features/settings/module';
import { toolsModule } from '../features/tools/module';
import type { ModuleBundle } from '../modules/contracts';

export const corePlugin = {
  id: 'kuroko.core',
  modules: [scenesModule, realmsModule, chatModule, toolsModule, copyMessageTextModule, settingsModule, appearanceModule, connectionModule],
  defaultScreen: 'kuroko.scenes.index',
  defaultSettingsTab: 'appearance',
  routeAliases: [
    { route: '#appearance', screen: 'kuroko.settings.index' },
    { route: '#secrets', screen: 'kuroko.settings.index', settingsTab: 'connection' },
  ],
} satisfies ModuleBundle;
