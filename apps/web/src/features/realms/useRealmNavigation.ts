import { useUnit } from 'effector-react';
import { useState, type MouseEvent } from 'react';
import { $realmEditor, $realmEditorBusy, $realmEditorHasUnsavedChanges, realmEditorClosed, realmEditorOpened } from './model';

export function useRealmNavigation() {
  const { editor, busy, dirty, open, close } = useUnit({
    editor: $realmEditor, busy: $realmEditorBusy, dirty: $realmEditorHasUnsavedChanges, open: realmEditorOpened, close: realmEditorClosed,
  });
  const [pending, setPending] = useState<{ id?: string } | null>(null);
  const editedId = editor?.status === 'ready' ? editor.saved?.id : editor?.status === 'loading' ? editor.request.id : editor?.id;

  function goToRealms(id?: string) {
    if (id === undefined || editedId !== id) {
      if (busy) return;
      close();
      if (id !== undefined) open(id);
    }
    setPending(null);
    window.location.assign('#realms');
  }

  return {
    open(id: string) {
      if (dirty && editedId !== id) setPending({ id });
      else goToRealms(id);
    },
    disabled: (id: string) => busy && editedId !== id,
    browse(event: MouseEvent<HTMLAnchorElement>) {
      if (!editor || busy || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (dirty) setPending({});
      else goToRealms();
    },
    confirmation: {
      opened: pending !== null,
      onClose: () => setPending(null),
      onDiscard: () => { if (pending) goToRealms(pending.id); },
    },
  };
}
