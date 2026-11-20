# Kuroko

Проект на Bun и TypeScript. API работает на Express, фронтенд — на Vite, React и Mantine UI.

## Быстрый старт

Понадобится Bun 1.4.5 или новее. Выполните из корня проекта.

```sh
bun install
bun run dev
```

- Фронтенд открывается по адресу <http://localhost:5173>.
- API отвечает по адресу <http://localhost:3000/api/health>. В режиме разработки Vite проксирует запросы `/api` с фронтенда.
- Чтобы изменить порт API, скопируйте `.env.example` в `.env` в корне проекта и задайте `PORT`. Перезапустите процессы после изменения.

## Скрипты запуска

Скрипты лежат в `scripts/`. На Windows можно открыть нужный `.bat` двойным кликом или вызвать из терминала. На Linux и macOS можно запускать `.sh` напрямую или через `sh`. Ниже приведены команды из корня проекта. Перед первым запуском установите зависимости командой `bun install`.

| Задача | Windows | Linux и macOS |
| --- | --- | --- |
| Запустить API и фронтенд для разработки | `.\scripts\dev.bat` | `sh ./scripts/dev.sh` |
| Запустить только API | `.\scripts\dev-api.bat` | `sh ./scripts/dev-api.sh` |
| Запустить только фронтенд | `.\scripts\dev-web.bat` | `sh ./scripts/dev-web.sh` |
| Собрать проект | `.\scripts\build.bat` | `sh ./scripts/build.sh` |
| Запустить готовую сборку | `.\scripts\start.bat` | `sh ./scripts/start.sh` |

## Команды

| Команда | Что делает |
| --- | --- |
| `bun install` | Устанавливает зависимости обоих приложений |
| `bun install --frozen-lockfile` | Устанавливает зависимости по зафиксированному lockfile |
| `bun run dev` | Запускает оба приложения с обновлением при изменениях |
| `bun run dev:api` | Запускает Express API в режиме наблюдения |
| `bun run dev:web` | Запускает Vite с горячим обновлением React |
| `bun run lint` | Проверяет исходники с помощью Oxlint |
| `bun run typecheck` | Проверяет типы обоих приложений |
| `bun run build` | Проверяет типы и собирает сервер и фронтенд в `dist/` |
| `bun run start` | Запускает production-сборку после `bun run build` |

## Структура

```text
apps/
  api/src/
    routes/api.ts  # Маршруты /api
    app.ts         # Express и обработка запросов
    server.ts      # Запуск сервера на Bun
  web/
    src/           # React и Mantine UI
    vite.config.ts # Сборка и прокси для разработки
dist/
  server.js        # Серверный бандл
  web/             # Статические файлы фронтенда
```

После сборки один процесс Express обслуживает фронтенд и API по адресу <http://localhost:3000>. Если перенести готовый каталог `dist/` отдельно, для запуска достаточно Bun. Из этого каталога выполните `bun ./server.js --serve-web`.

## Лицензия

Kuroko распространяется по лицензии [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`).
