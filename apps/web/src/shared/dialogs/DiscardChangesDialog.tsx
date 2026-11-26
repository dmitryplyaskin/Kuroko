import { Button, Group, Modal } from '@mantine/core';
import { useI18n } from '../i18n/i18n';

export function DiscardChangesDialog({ opened, onClose, onDiscard }: {
  opened: boolean;
  onClose: () => void;
  onDiscard: () => void;
}) {
  const { t } = useI18n();
  return <Modal opened={opened} onClose={onClose} title={t('common.discardTitle')}
    closeButtonProps={{ 'aria-label': t('common.close') }}>
    <p>{t('common.discardBody')}</p>
    <Group justify="flex-end" gap="sm" mt="md">
      <Button type="button" variant="default" data-autofocus onClick={onClose}>{t('common.keepEditing')}</Button>
      <Button type="button" color="red" onClick={onDiscard}>{t('common.discardChanges')}</Button>
    </Group>
  </Modal>;
}
