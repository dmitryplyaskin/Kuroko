import { LocalizedText } from '../shared/i18n/LocalizedText';
import { useI18n } from '../shared/i18n/i18n';
import { Component, Suspense, useEffect, type ReactNode } from 'react';
import type { RegisteredScreen, RegisteredTab } from './registry';

class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <p className="module-view-status" role="alert"><LocalizedText id="error.module_load_failed" /></p>
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
  const { View, loadingLabel = 'common.loading' } = entry;
  return (
    <ViewErrorBoundary key={entry.id}>
      <Suspense fallback={<output className="module-view-status">{t(loadingLabel)}</output>}>
        <View />
        {onReady && <ViewReady onReady={onReady} />}
      </Suspense>
    </ViewErrorBoundary>
  );
}
