import { Button } from '@mantine/core';
import { LocalizedText } from '../shared/i18n/LocalizedText';
import { useI18n } from '../shared/i18n/i18n';
import { Component, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { RegisteredScreen, RegisteredTab } from './registry';
import { reloadSettingsTab } from './settingsNavigation';

class ViewErrorBoundary extends Component<{ children: ReactNode; actions?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <div className="module-view-status">
        <p role="alert"><LocalizedText id="error.module_load_failed" /></p>
        {this.props.actions}
      </div>
      : this.props.children;
  }
}

function ViewReady({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

export function ModuleView({ entry, onReady }: {
  entry: RegisteredScreen | RegisteredTab;
  onReady?: () => void;
}) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const { View, loadingLabel = 'common.loading' } = entry;
  function retry() {
    if (!('resetFailedLoad' in entry)) return;
    entry.resetFailedLoad();
    setAttempt((value) => value + 1);
  }

  return (
    <ViewErrorBoundary key={`${entry.id}:${attempt}`} actions={'resetFailedLoad' in entry &&
      <Button variant="default" onClick={attempt ? () => reloadSettingsTab(entry.key) : retry}>
        {t(attempt ? 'common.reloadPage' : 'common.retryLoad')}
      </Button>}>
      <Suspense fallback={<output className="module-view-status">{t(loadingLabel)}</output>}>
        <View />
        {onReady && <ViewReady onReady={onReady} />}
      </Suspense>
    </ViewErrorBoundary>
  );
}
