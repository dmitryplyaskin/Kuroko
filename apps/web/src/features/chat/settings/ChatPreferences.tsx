import { LocalizedText } from '../../../shared/i18n/LocalizedText';
import { useI18n } from '../../../shared/i18n/i18n';
import { Button, ColorInput, SegmentedControl, useComputedColorScheme, type ButtonProps } from '@mantine/core';
import { Bot, Check, UserRound } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useId, useState, type CSSProperties } from 'react';
import {
  chatColorRoles, chatFontSize, chatWidth, defaultChatSettings, isChatColor, sameChatSettings,
  type ChatColor, type ChatColorScheme,
} from '@kuroko/contracts/chatSettings';
import { $theme } from '../../../shared/theme/appearanceModel';
import { ChatText } from '../ChatText';
import { chatDisplayStyle } from '../chatDisplayStyle';
import {
  $chatSettingsDraft, $chatSettingsDirty, $chatSettingsLoad, $chatSettingsSubmission, chatSettingsChanged,
  chatSettingsColorChanged, chatSettingsResetRequested, chatSettingsRetryRequested, chatSettingsSaveRequested,
} from './model';
import './chatPreferences.css';

const actionButtonStyles: ButtonProps['styles'] = {
  root: { maxInlineSize: '100%' },
  label: { whiteSpace: 'normal' },
};

const previewMessages = [
  { role: 'user', text: 'chatSettings.previewUser1' },
  { role: 'assistant', text: 'chatSettings.previewModel1' },
  { role: 'user', text: 'chatSettings.previewUser2' },
  { role: 'assistant', text: 'chatSettings.previewModel2' },
] as const;

function SizeSlider({ label, value, bounds, onChange }: {
  label: string;
  value: number;
  bounds: typeof chatWidth;
  onChange: (value: number) => void;
}) {
  const { t, number } = useI18n();
  const id = useId();
  const count = number.format(value);
  return (
    <div className="chat-setting-slider">
      <label htmlFor={id}>{label}</label>
      <span aria-hidden="true">{t('chatSettings.pixelsShort', { count })}</span>
      <input id={id} type="range" {...bounds} value={value} aria-valuetext={t('chatSettings.pixels', { count })}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </div>
  );
}

function ChatColorInput({ role, value, onChange }: {
  role: ChatColor;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<{ text: string; from: string }>();
  return (
    <ColorInput label={t(`chatSettings.${role}`)} value={draft?.from === value ? draft.text : value}
      format="hex" maxLength={7} spellCheck={false} fixOnBlur={false} withEyeDropper={false}
      onChange={(next) => {
        if (isChatColor(next)) {
          setDraft(undefined);
          onChange(next);
        } else {
          setDraft({ text: next, from: value });
        }
      }} onBlur={() => setDraft(undefined)} />
  );
}

export default function ChatPreferences() {
  const { t } = useI18n();
  const { load, settings, dirty, submission, change, changeColor, reset, retry, save } = useUnit({
    load: $chatSettingsLoad, settings: $chatSettingsDraft, dirty: $chatSettingsDirty, submission: $chatSettingsSubmission,
    change: chatSettingsChanged, changeColor: chatSettingsColorChanged, reset: chatSettingsResetRequested,
    retry: chatSettingsRetryRequested, save: chatSettingsSaveRequested,
  });
  const activeScheme = useComputedColorScheme('light');
  const [selectedScheme, setSelectedScheme] = useState<ChatColorScheme>();
  const scheme = selectedScheme ?? activeScheme;
  const theme = useUnit($theme);
  const palette = theme[scheme];
  const themeColors = { text: palette.text, speech: palette.accent, emphasis: palette.muted, quote: palette.muted };
  const saving = submission.status === 'saving';
  const previewStyle = {
    ...chatDisplayStyle(settings, scheme),
    backgroundColor: palette.canvas,
    color: palette.text,
    borderColor: palette.border,
    '--kr-text': palette.text,
    '--kr-muted': palette.muted,
    '--kr-surface': palette.surface,
    '--kr-hover': palette.hover,
    '--kr-border': palette.border,
    '--kr-accent': palette.accent,
    '--kr-accent-text': palette.accentText,
    '--kr-accent-surface': palette.accentSurface,
    '--kr-control': palette.control,
    '--chat-demo-inset': `${(chatWidth.max - settings.width) / (chatWidth.max - chatWidth.min) * 9}%`,
  } satisfies CSSProperties & Record<`--${string}`, string | undefined>;

  if (load.status === 'loading') return <output>{t('chatSettings.loading')}</output>;
  if (load.status === 'error') {
    return (
      <div className="chat-preferences-feedback">
        <p role="alert">{t(`error.${load.code}`)}</p>
        <Button type="button" variant="default" onClick={retry}>{t('common.retryLoad')}</Button>
      </div>
    );
  }

  const unsaved = load.fromBrowser ? t('chatSettings.browserDraft') : t('chatSettings.unsaved');
  const status = { saving: t('chatSettings.saving'), idle: dirty ? unsaved : '', error: '' }[submission.status];

  return (
    <div className="chat-preferences">
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <div className="chat-preferences-controls">
          <fieldset className="field-group chat-size-controls" disabled={saving}>
            <legend>{t('chatSettings.layout')}</legend>
            <SizeSlider label={t('chatSettings.fontSize')} bounds={chatFontSize} value={settings.fontSize}
              onChange={(fontSize) => change({ fontSize })} />
            <SizeSlider label={t('chatSettings.width')} bounds={chatWidth} value={settings.width}
              onChange={(width) => change({ width })} />
            <fieldset className="chat-side-options">
              <legend>{t('chatSettings.userMessages')}</legend>
              <div>
                {(['left', 'right'] as const).map((side) => (
                  <label className="choice-option" key={side}>
                    <input type="radio" name="chat-user-side" checked={settings.userSide === side}
                      onChange={() => change({ userSide: side })} />
                    <span>{side === 'left' ? t('chatSettings.left') : t('chatSettings.right')}</span>
                    <Check className="option-check" size={17} aria-hidden="true" />
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
          <fieldset className="field-group" disabled={saving}>
            <legend>{t('chatSettings.textColors')}</legend>
            <SegmentedControl fullWidth aria-label={t('chatSettings.colorScheme')} value={scheme}
              onChange={(value) => setSelectedScheme(value === 'dark' ? 'dark' : 'light')}
              data={[{ label: t('chatSettings.light'), value: 'light' }, { label: t('chatSettings.dark'), value: 'dark' }]} />
            <div className="chat-color-controls">
              {chatColorRoles.map((role) => (
                <ChatColorInput key={`${scheme}-${role}`} role={role} value={settings.colors[scheme][role] ?? themeColors[role]}
                  onChange={(color) => changeColor({ scheme, role, color })} />
              ))}
            </div>
            <p className="chat-color-hint">
              <LocalizedText id="chatSettings.formattingHint" values={{
                action: <code>{t('chatSettings.actionExample')}</code>, quote: <code>{t('chatSettings.quoteExample')}</code>,
              }} />
            </p>
          </fieldset>
        </div>
        <div className="chat-preferences-actions">
          <Button type="button" variant="subtle" styles={actionButtonStyles} disabled={saving || sameChatSettings(settings, defaultChatSettings)}
            onClick={reset}>{t('chatSettings.reset')}</Button>
          <Button type="submit" styles={actionButtonStyles} loading={saving} disabled={!dirty}>{t('chatSettings.save')}</Button>
        </div>
        {submission.status === 'error'
          ? <p className="chat-preferences-error" role="alert">{t(`error.${submission.code}`)}</p>
          : <output className="chat-preferences-status">{status}</output>}
      </form>

      <section className="chat-preferences-preview" aria-labelledby="chat-preview-heading">
        <h2 id="chat-preview-heading">{t('chatSettings.preview')}</h2>
        <div className="chat-settings-demo" style={previewStyle} data-user-side={settings.userSide}>
          {previewMessages.map(({ role, text }) => {
            const user = role === 'user';
            return (
              <article className="chat-demo-turn" data-author={role} key={text}>
                <span className="icon-tile account-avatar" aria-hidden="true">{user ? <UserRound size={18} /> : <Bot size={18} />}</span>
                <div className="chat-demo-message">
                  <h3>{user ? t('chatSettings.you') : t('common.model')}</h3>
                  <div className="chat-message-content"><ChatText user={user}>{t(text)}</ChatText></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
