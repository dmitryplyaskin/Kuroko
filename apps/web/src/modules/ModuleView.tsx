import { Component, Suspense, useEffect, type ReactNode } from 'react';
import type { RegisteredScreen, RegisteredTab } from './registry';

class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <p className="module-view-status" role="alert">Не удалось загрузить этот раздел.</p>
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
  const { View, loadingLabel = 'Загрузка…' } = entry;
  return (
    <ViewErrorBoundary key={entry.id}>
      <Suspense fallback={<output className="module-view-status">{loadingLabel}</output>}>
        <View />
        {onReady && <ViewReady onReady={onReady} />}
      </Suspense>
    </ViewErrorBoundary>
  );
}
