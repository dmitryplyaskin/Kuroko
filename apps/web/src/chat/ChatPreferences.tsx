import { Button, ColorInput, SegmentedControl, useComputedColorScheme } from '@mantine/core';
import { Bot, Check, UserRound } from 'lucide-react';
import { useId, useState, type CSSProperties } from 'react';
import {
  chatColorRoles, chatFontSize, chatWidth, defaultChatSettings, isChatColor, sameChatSettings,
  type ChatColor, type ChatColorScheme,
} from '../../../shared/chatSettings';
import { useAppearance } from '../theme';
import { ChatText } from './ChatText';
import { chatDisplayStyle, type useChatSettings } from './chatSettings';
import './chat.css';
import './chatPreferences.css';

const colorLabels: Record<ChatColor, string> = {
  text: 'Основной текст',
  speech: 'Прямая речь',
  emphasis: 'Действия и курсив',
  quote: 'Блоки цитат',
};

const previewMessages = [
  { role: 'user', text: '«Ты слышишь поезд?»' },
  {
    role: 'assistant',
    text: 'На платформе тихо. За туманом виден **один фонарь**, а на табло до сих пор горит время отправления.\n\n«Слышу. Он уже близко».\n\n*Я отступаю от края платформы и ищу билет в кармане.*\n\n> Поезд прибывает на второй путь.',
  },
  { role: 'user', text: '— Что нужно проверить перед посадкой?\n\n*Открываю блокнот.*' },
  {
    role: 'assistant',
    text: '### Перед посадкой\n\n1. Сверь номер пути с табло.\n2. Проверь, совпадает ли время на билете с расписанием.\n\n| Путь | Отправление |\n| --- | --- |\n| 2 | 23:47 |\n\nЕсли ведёшь список поездов в коде, эту запись можно сохранить так:\n\n```ts\nconst departure = { platform: 2, time: "23:47" };\n```',
  },
] as const;

function SizeSlider({ label, value, bounds, onChange }: {
  label: string;
  value: number;
  bounds: typeof chatWidth;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="chat-setting-slider">
      <label htmlFor={id}>{label}</label>
      <span aria-hidden="true">{value} px</span>
      <input id={id} type="range" {...bounds} value={value} aria-valuetext={`${value} пикселей`}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </div>
  );
}

function ChatColorInput({ role, value, onChange }: {
  role: ChatColor;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState<{ text: string; from: string }>();
  return (
    <ColorInput label={colorLabels[role]} value={draft?.from === value ? draft.text : value}
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

export default function ChatPreferences({ accountSettings }: { accountSettings: ReturnType<typeof useChatSettings> }) {
  const { load, draft: settings, setDraft: setSettings, dirty, submission, retry, save } = accountSettings;
  const activeScheme = useComputedColorScheme('light');
  const [selectedScheme, setSelectedScheme] = useState<ChatColorScheme>();
  const scheme = selectedScheme ?? activeScheme;
  const { theme } = useAppearance();
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

  function setColor(role: ChatColor, color: string) {
    setSettings((current) => ({ ...current, colors: { ...current.colors, [scheme]: { ...current.colors[scheme], [role]: color.toLowerCase() } } }));
  }

  if (load.status === 'loading') return <output>Загружаем настройки чата…</output>;
  if (load.status === 'error') {
    return (
      <div className="chat-preferences-feedback">
        <p role="alert">{load.message}</p>
        <Button type="button" variant="default" onClick={retry}>Повторить загрузку</Button>
      </div>
    );
  }

  const unsaved = load.fromBrowser ? 'Настройки из этого браузера готовы к сохранению в аккаунте.' : 'Есть несохранённые изменения.';
  const status = { saving: 'Сохраняем…', idle: dirty ? unsaved : '', error: '' }[submission.status];

  return (
    <div className="chat-preferences">
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="chat-preferences-controls">
          <fieldset className="appearance-group chat-size-controls" disabled={saving}>
            <legend>Размер и расположение</legend>
            <SizeSlider label="Размер текста" bounds={chatFontSize} value={settings.fontSize}
              onChange={(fontSize) => setSettings((current) => ({ ...current, fontSize }))} />
            <SizeSlider label="Ширина чата" bounds={chatWidth} value={settings.width}
              onChange={(width) => setSettings((current) => ({ ...current, width }))} />
            <fieldset className="chat-side-options">
              <legend>Сообщения пользователя</legend>
              <div>
                {(['left', 'right'] as const).map((side) => (
                  <label className="appearance-option" key={side}>
                    <input type="radio" name="chat-user-side" checked={settings.userSide === side}
                      onChange={() => setSettings((current) => ({ ...current, userSide: side }))} />
                    <span>{side === 'left' ? 'Слева' : 'Справа'}</span>
                    <Check className="option-check" size={17} aria-hidden="true" />
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
          <fieldset className="appearance-group" disabled={saving}>
            <legend>Цвета текста</legend>
            <SegmentedControl fullWidth aria-label="Тема цветов чата" value={scheme}
              onChange={(value) => setSelectedScheme(value === 'dark' ? 'dark' : 'light')}
              data={[{ label: 'Светлая тема', value: 'light' }, { label: 'Тёмная тема', value: 'dark' }]} />
            <div className="chat-color-controls">
              {chatColorRoles.map((role) => (
                <ChatColorInput key={`${scheme}-${role}`} role={role} value={settings.colors[scheme][role] ?? themeColors[role]}
                  onChange={(color) => setColor(role, color)} />
              ))}
            </div>
            <p className="chat-color-hint">
              Прямую речь можно взять в «кавычки» или начать с тире. Для действий используйте <code>*текст*</code>, для цитат — <code>&gt; текст</code>.
            </p>
          </fieldset>
        </div>
        <div className="form-actions chat-preferences-actions">
          <Button type="button" variant="subtle" disabled={saving || sameChatSettings(settings, defaultChatSettings)}
            onClick={() => setSettings(defaultChatSettings)}>Вернуть значения по умолчанию</Button>
          <Button type="submit" loading={saving} disabled={!dirty}>Сохранить изменения</Button>
        </div>
        {submission.status === 'error'
          ? <p className="chat-preferences-error" role="alert">{submission.message}</p>
          : <output className="chat-preferences-status">{status}</output>}
      </form>

      <section className="chat-preferences-preview" aria-labelledby="chat-preview-heading">
        <h2 id="chat-preview-heading">Предпросмотр</h2>
        <div className="chat-settings-demo" style={previewStyle} data-user-side={settings.userSide}>
          {previewMessages.map(({ role, text }) => {
            const user = role === 'user';
            return (
              <article className="chat-demo-turn" data-author={role} key={text}>
                <span className="account-avatar" aria-hidden="true">{user ? <UserRound size={18} /> : <Bot size={18} />}</span>
                <div className="chat-demo-message">
                  <h3>{user ? 'Вы' : 'Модель'}</h3>
                  <div className="chat-message-content"><ChatText user={user}>{text}</ChatText></div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
