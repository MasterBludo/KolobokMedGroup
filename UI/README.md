# Recovery UI

Frontend приложения Recovery: React 19, TypeScript, Vite 8, Tailwind CSS 4 и Motion.

Полное описание продукта, установка Node.js/Python/PostgreSQL, настройка GigaChat, миграции и запуск доступны в [основном README](../README.md).

Зависимости обоих npm-пакетов устанавливаются **из корня репозитория**:

```bash
npm ci
```

После подготовки базы и корневого `.env` запустите из корня два процесса в отдельных терминалах:

```bash
npm run dev:backend
```

```bash
npm --workspace UI run dev:frontend
```

Откройте http://localhost:5173. Vite проксирует `/api` на http://localhost:3000. Вход, регистрация, чат и сохранение требуют работающего backend; персональные данные хранятся в PostgreSQL. Сервер читает корневой `.env`, ключ Gemini не используется.

Команды из каталога `UI`:

```bash
npm run dev:frontend
npm run typecheck
npm run build
```

Сборка записывается в корневой `dist/`. `npm run preview` показывает frontend-сборку, но не запускает API; для полного приложения используйте описанную в основном README раздачу через Express.
