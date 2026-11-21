import { chatModule } from '../features/chat/module';
import { connectionModule } from '../features/connection/module';
import { scenesModule } from '../features/scenes/module';
import { appearanceModule } from '../features/settings/appearanceModule';
import { settingsModule } from '../features/settings/module';
import type { ModuleBundle } from '../modules/contracts';

export const corePlugin = {
  id: 'kuroko.core',
  modules: [scenesModule, chatModule, settingsModule, appearanceModule, connectionModule],
  defaultScreen: 'kuroko.scenes.index',
  defaultSettingsTab: 'appearance',
  routeAliases: [
    { route: '#appearance', screen: 'kuroko.settings.index' },
    { route: '#secrets', screen: 'kuroko.settings.index', settingsTab: 'connection' },
  ],
} satisfies ModuleBundle;
