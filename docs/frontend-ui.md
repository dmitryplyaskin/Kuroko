# Компоненты и шаблоны интерфейса Kuroko

## Общие компоненты

| Компонент | Назначение | Реализация и пример |
| --- | --- | --- |
| `PresetControls` | Выбор пресета и меню создания, сохранения, копирования, переименования и удаления. Экран передаёт список, выбранный ID, доступность действий и экземпляр модели пресетов. Модель фичи хранит имя, статус операции и результат. Компонент управляет фокусом. | [Компонент](../apps/web/src/shared/presets/PresetControls.tsx) · [Подключение](../apps/web/src/features/connection/ConnectionSettings.tsx) · [Инструкции](../apps/web/src/features/instructions/Instructions.tsx) · [Инструменты](../apps/web/src/features/tools/ToolManager.tsx) |
| `AgentToolPicker` | Выбор разрешённых инструментов из каталога. Внутри компонента остаются поиск, фильтр выбранных и перевод фокуса после снятия отметки. Список сохраняет фича, которая открыла форму. | [Компонент](../apps/web/src/features/tools/AgentToolPicker.tsx) · [Редактор агента](../apps/web/src/features/agents/AgentEditor.tsx) · [Инструменты разовых агентов](../apps/web/src/features/tools/ToolManager.tsx) |
| `PromptTextarea`, `TemplateGuideModal` | Поле текста с доступом к справке и диалог справки по шаблонам. Параметр `scope` задаёт доступные примеры. | [Компоненты](../apps/web/src/shared/prompt-templates/TemplateHelp.tsx) · [Инструкции](../apps/web/src/features/instructions/Instructions.tsx) · [Меню чата](../apps/web/src/features/chat/ChatMenu.tsx) |
| `PromptTemplateControls` | Предпросмотр текста и выбор связанного мира. Фича инструкций владеет запросами, отменой и повтором. Компонент возвращает выбранный мир и предлагаемый фрагмент шаблона редактору. | [Компонент](../apps/web/src/features/instructions/PromptTemplateControls.tsx) · [Инструкции](../apps/web/src/features/instructions/Instructions.tsx) · [Агенты](../apps/web/src/features/agents/AgentEditor.tsx) |
| `DiscardChangesDialog` | Подтверждение отказа от черновика. При открытии фокус на «Продолжить редактирование». Escape закрывает диалог и возвращает фокус на кнопку, открывшую его. | [Компонент](../apps/web/src/shared/dialogs/DiscardChangesDialog.tsx) · [Редактор мира](../apps/web/src/features/realms/RealmEditor.tsx) · [Редактор агента](../apps/web/src/features/agents/AgentEditor.tsx) |
| `RealmLink` | Подчёркнутое название связанного мира. Экран передаёт переход из `useRealmNavigation`, который учитывает несохранённые правки в карточке мира. | [Компонент](../apps/web/src/features/realms/RealmLink.tsx) · [Главная](../apps/web/src/features/home/Home.tsx) · [История чатов](../apps/web/src/features/chat/history/ChatHistoryPage.tsx) |
| `LanguageSelect` | Выбор языка интерфейса из общих предпочтений браузера. Компактный режим подходит для панели гостевого экрана. | [Компонент](../apps/web/src/shared/i18n/LanguageSelect.tsx) · [Внешний вид](../apps/web/src/features/settings/Appearance.tsx) |
| `LocalizedText` | Переведённое сообщение со вставками React, например со ссылкой внутри предложения. Для строк без разметки используйте `t` из `useI18n`. | [Компонент](../apps/web/src/shared/i18n/LocalizedText.tsx) · [Подсказка в списке агентов](../apps/web/src/features/agents/Agents.tsx) |
| `SceneCover` | Иллюстрация и подпись к примеру сцены на форме входа. | [Компонент](../apps/web/src/shared/scene-cover/SceneCover.tsx) · [Гостевой экран](../apps/web/src/app/GuestLayout.tsx) |
| `notify`, `NotificationAnnouncements` | Временные уведомления с очередью, визуальным отображением и объявлением для скринридера. | [Хранилище и объявления](../apps/web/src/shared/notifications/notifications.tsx) · [Отображение](../apps/web/src/shared/notifications/AppNotifications.tsx) · [Инициализация](../apps/web/src/main.tsx) |
| `KurokoThemeProvider`, `ThemeMenu` | Общая тема и меню выбора цветовой схемы. Провайдер связывает тему Mantine с CSS-переменными Kuroko. | [Провайдер](../apps/web/src/shared/theme/theme.tsx) · [Меню](../apps/web/src/shared/theme/ThemeMenu.tsx) · [Гостевой экран](../apps/web/src/app/GuestLayout.tsx) |

## Шаблоны экранов

- **Библиотека карточек.** Миры и персоны используют общую раскладку панели поиска, фильтров и результатов. `LibraryItem` выводит аватар, краткое описание, метаданные и действия карточки. `LibraryViewSwitch` переключает список и сетку, а `LibraryPagination` отображает текущий диапазон. Запросами и фильтрами управляет соответствующая фича. [Стили библиотеки](../apps/web/src/shared/library/Library.module.css) · [Карточки](../apps/web/src/shared/library/LibraryItem.tsx) · [Управление видом](../apps/web/src/shared/library/LibraryControls.tsx) · [Миры](../apps/web/src/features/realms/RealmLibrary.tsx) · [Персоны](../apps/web/src/features/personas/PersonaLibrary.tsx)
- **Действия с чатом.** `ChatActions` показывает отдельную кнопку удаления и меню переименования, копирования, просмотра лога и экспорта. `ChatManagementDialog` использует модель чата и показывает форму переименования или подтверждение удаления на экране, с которого его открыли. [Действия](../apps/web/src/features/chat/ChatActions.tsx) · [Диалог](../apps/web/src/features/chat/ChatManagementDialog.tsx) · [История](../apps/web/src/features/chat/history/ChatHistoryPage.tsx)
- **Заголовок страницы.** Используйте `<header className="page-heading">` с `<h1 tabIndex={-1}>` и коротким описанием в `<p>`, если оно нужно. Оболочка переводит фокус на `h1` после открытия. Настройки, инструкции и инструменты используют одинаковую разметку, а миры и агенты добавляют навигацию, аватар или действия. [Стили заголовка](../apps/web/src/shared/styles/page.css) · [Настройки](../apps/web/src/features/settings/Settings.tsx) · [Редактор мира](../apps/web/src/features/realms/RealmEditor.tsx)
- **Поля переменных.** `VariableFields` показывает имя, тип и значение переменной, позволяет добавлять и удалять строки. `PromptTextarea` показывает справку для переменных мира или персоны в зависимости от `scope`. Черновик и проверка при сохранении принадлежат модели редактора. [Компонент](../apps/web/src/shared/variables/VariableFields.tsx) · [Миры](../apps/web/src/features/realms/RealmVariables.tsx) · [Персоны](../apps/web/src/features/personas/PersonaEditor.tsx)
- **Вкладки.** Используйте Mantine Tabs с доступным именем для `Tabs.List`. Настройки и редактор агента используют высоту 44 px, приглушённый неактивный текст и границу темы. В настройках активная подпись окрашена акцентом, а в редакторе агента акцентом выделяется граница. Вкладки журнала и справки используют более плотную разметку. Общая разметка Mantine покрывает все варианты, размеры и состояние видимости панелей задаёт экран. [Настройки](../apps/web/src/features/settings/Settings.module.css) · [Редактор агента](../apps/web/src/features/agents/Agents.module.css) · [Журнал](../apps/web/src/features/chat/ChatLog.tsx)
- **Сохранение и выход из редактора.** Модель хранит черновик, вычисляет признак изменений и привязывает завершение записи к текущей сессии. Экран переводит код ошибки, показывает результат сохранения и подтверждает выход в библиотеку при наличии правок. Предупреждение при закрытии вкладки подключает оболочка. [Модель агентов](../apps/web/src/features/agents/model.ts) · [Модель миров](../apps/web/src/features/realms/model.ts) · [Оболочка](../apps/web/src/app/Workspace.tsx)
- **Загрузка и повтор.** При загрузке показывайте локализованный статус, при сбое объявляйте ошибку и предлагайте повтор. Экраны рабочего пространства и вкладки настроек используют общий `ModuleView`. Загруженные модули отображают ошибки запросов данных. Если браузер повторно выдаёт ошибку импорта, действие «Обновить страницу» возвращает на тот же экран или вкладку. [Загрузка модуля](../apps/web/src/modules/ModuleView.tsx) · [Подключение](../apps/web/src/features/connection/ConnectionSettings.tsx)

## Оформление

Локальные классы объявляйте в CSS Modules. Для общих цветов, шрифтов и скруглений используйте переменные `--kr-*` из темы. Имена локальных классов генерируются при сборке. [Тема](../apps/web/src/shared/theme/theme.tsx)

| Назначение | Переменные темы |
| --- | --- |
| Поверхности и границы | `--kr-canvas`, `--kr-surface`, `--kr-sidebar`, `--kr-hover`, `--kr-border`, `--kr-control` |
| Текст и ошибка | `--kr-text`, `--kr-muted`, `--kr-danger` |
| Акцент | `--kr-accent`, `--kr-accent-hover`, `--kr-accent-text`, `--kr-accent-surface` |
| Шрифты и скругления | `--kr-font-interface`, `--kr-font-story`, `--kr-radius-control`, `--kr-radius-panel`, `--kr-radius-cover` |

Оформление чата и его предпросмотра использует следующие атрибуты и переменные.

| Элемент | Атрибуты или переменные |
| --- | --- |
| Контейнер чата или предпросмотра | `data-user-side="left"` и `data-user-side="right"` задают сторону пользовательских сообщений. `--chat-column` и `--chat-text-size` задают ширину колонки и размер текста. |
| Сообщение | `data-author="user"` или `data-author="assistant"` задаёт автора. `data-chat-content` отмечает контейнер содержимого. Текст обоих участников занимает общую центральную колонку, а аватары стоят в боковых колонках. |
| Текст Markdown | `data-chat-markdown="user"` сохраняет переносы в пользовательском тексте. Значение `assistant` включает обычное отображение Markdown. `data-chat-speech` отмечает прямую речь. Встроенные изображения занимают ширину содержимого сообщения и сохраняют пропорции. |
| Цвет текста | `--chat-color-text`, `--chat-color-speech`, `--chat-color-emphasis` и `--chat-color-quote` задают пользовательские цвета. При отсутствии значения применяется тема. |

[Стили чата](../apps/web/src/features/chat/Chat.module.css) · [Разметка Markdown](../apps/web/src/features/chat/ChatText.tsx) · [Переменные чата](../apps/web/src/features/chat/chatDisplayStyle.ts)
