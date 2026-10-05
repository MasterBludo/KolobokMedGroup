# AI Post-Operative Recovery Platform

Цифровой слой сопровождения пациента между выпиской из стационара и следующим врачебным контактом.

---

## 1. Описание проблемы и решения

### Проблема

После выписки из стационара пациент остаётся один на один с бумажной выпиской и набором инструкций. Восстановление — это динамический процесс, в ходе которого у пациентов регулярно возникают рутинные вопросы. Это приводит к:

* Лишней нагрузке на медперсонал и регистратуру (телефонные звонки, повторные неинформативные визиты).
* Потере контекста и времени врача на сбор анамнеза, если у пациента действительно возникло осложнение.

### Решение

**AI Post-Operative Recovery Platform** — цифровой слой сопровождения пациента между выпиской и следующим врачебным контактом.

Система автоматически превращает выписку в персонализированный план восстановления (`Recovery Plan`), ежедневно отслеживает симптомы пациента, самостоятельно закрывает типовые вопросы в рамках утверждённого клинического протокола Минздрава РФ и заблаговременно эскалирует случаи с отклонениями к врачу с готовым клиническим анамнезом.

### Ключевой инженерный принцип

LLM не принимает клинических решений и не диагностирует осложнения.

* **LLM (GigaChat)** отвечает за распознавание документов, ведение диалога на естественном языке и структурирование данных.
* **Детерминированный алгоритм (Python Rule Engine)** отвечает за триаж состояния пациента (`NORMAL`, `REVIEW`, `URGENT`) на основе зафиксированных правил медицинского протокола.

---

## 2. Диаграмма движения информации в системе (Data Flow)

```text
[ Пациент ]
    │
    ├─► (Загружает PDF / Фото / Текст выписки)
    │           │
    │           ▼
    │   [ LLM #1: Document Extraction ] ──► Превращает текст в JSON
    │           │
    │           ▼
    │   [ Экран валидации ] ──► Пациент подтверждает дозировки и даты
    │           │
    │           ▼
    │   [ Recovery Plan Engine ] ◄── [ База знаний: Протоколы Минздрава ]
    │           │
    │           ▼
    ├─► (Ежедневный Check-in / Чат с вопросами)
    │           │
    │           ▼
    │   [ LLM #2: Patient Companion ] ──► Извлекает структуру симптомов (JSON)
    │           │
    │           ▼
    │   [ Python Rule Engine ] ──► Детерминированный триаж состояния
    │           │
    ├───────────┼──────────────────────────┐
    ▼           ▼                          ▼
🟢 NORMAL   🟡 REVIEW                  🔴 URGENT
(AI сам     (Формирование анамнеза     (Инструкция
отвечает)    через LLM #3 ──► Врач)     экстренной помощи)
```

---

## 3. Технические подробности (Technical Specifications)

### 3.1. Разделение ответственности AI и Python-кода

| Компонент | Тип | Функция | Входные данные | Выходные данные |
| --- | --- | --- | --- | --- |
| **LLM #1: Extractor** | AI Model (GigaChat) | Извлечение медицинских назначений из текста/OCR | Сырой текст выписки | `MedicalDocumentExtraction` (JSON) |
| **LLM #2: Companion** | AI Model (GigaChat) | Диалог с пациентом, извлечение текущих симптомов | Текст сообщения пациента, история, контекст дня | Текстовый ответ пациенту + `DailyCheckinState` (JSON) |
| **LLM #3: Summarizer** | AI Model (GigaChat) | Генерация 30-секундного брифа (анамнеза) для врача | История чек-инов и симптомов за N дней | `ClinicalSummary` (JSON + Markdown) |
| **Rule Engine** | Python Code | Оценка риска и принятие решения о маршрутизации | `DailyCheckinState` + `ClinicalProtocol` | Статус: `NORMAL` \| `REVIEW` \| `URGENT` |

---

### 3.2. Строгие JSON-схемы данных (для промптов LLM)

#### Schema 1: Результат работы LLM #1 (`MedicalDocumentExtraction`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "procedure": { "type": "string" },
    "surgery_date": { "type": "string", "format": "date" },
    "medications": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "dose": { "type": "string" },
          "frequency": { "type": "string" },
          "duration_days": { "type": "integer" }
        },
        "required": ["name", "dose", "frequency"]
      }
    },
    "activity_restrictions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "instruction": { "type": "string" },
          "days_range": { "type": "string" }
        }
      }
    },
    "follow_up_date": { "type": ["string", "null"], "format": "date" }
  },
  "required": ["procedure", "surgery_date", "medications"]
}
```

#### Schema 2: Результат работы LLM #2 (`DailyCheckinState`)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "day_after_surgery": { "type": "integer" },
    "pain_level": { "type": "integer", "minimum": 0, "maximum": 10 },
    "pain_trend": { "type": "string", "enum": ["improving", "stable", "worsening"] },
    "temperature_celsius": { "type": ["number", "null"] },
    "red_flags_present": {
      "type": "array",
      "items": { "type": "string" }
    },
    "medication_adherence": { "type": "boolean" },
    "patient_notes": { "type": "string" }
  },
  "required": ["day_after_surgery", "pain_level", "pain_trend", "red_flags_present"]
}
```

---

### 3.3. Логика работы Python Rule Engine (Триаж)

```python
from enum import Enum

class TriageStatus(Enum):
    NORMAL = "NORMAL"
    REVIEW = "REVIEW"
    URGENT = "URGENT"

def evaluate_recovery(state: dict, protocol: dict) -> TriageStatus:
    # 1. Проверка на абсолютные Red Flags (Экстренное состояние)
    for flag in state.get("red_flags_present", []):
        if flag in protocol.get("critical_red_flags", []):
            return TriageStatus.URGENT

    if state.get("temperature_celsius") and state["temperature_celsius"] >= 38.5:
        return TriageStatus.URGENT

    # 2. Проверка на отклонения, требующие внимания врача (Review)
    if state.get("pain_level", 0) >= 7:
        return TriageStatus.REVIEW
    
    if state.get("pain_trend") == "worsening" and state.get("day_after_surgery", 0) > 3:
        return TriageStatus.REVIEW

    if state.get("temperature_celsius") and 37.5 <= state["temperature_celsius"] < 38.5:
        return TriageStatus.REVIEW

    # 3. Нормальное течение процесса восстановления
    return TriageStatus.NORMAL
```

---

### 3.4. Архитектура базы данных (PostgreSQL)

* **`users` / `patients`**: Учётные данные и профиль пациента.
* **`medical_documents`**: Ссылка на оригинальный файл выписки (PDF/Image) в S3 + статус OCR.
* **`document_extractions`**: Валидированный пациентом JSON извлечённых назначений.
* **`clinical_protocols`**: Статические справочники правил для конкретных операций из КР Минздрава.
* **`recovery_plans`**: Сгенерированный график и задачи по дням (Лекарства, Активность, Чек-ины).
* **`checkins`**: Ежедневные отклики пациента + сохраненный JSON `DailyCheckinState`.
* **`triage_events`**: Лог сработанных правил триажа (`NORMAL`/`REVIEW`/`URGENT`) с временной меткой.
* **`clinical_summaries`**: Автоматически сгенерированные брифы для врача перед приёмом.

---

### 3.5. REST API Эндпоинты (FastAPI)

* `POST /api/v1/documents/upload` — загрузка выписки (PDF/Фото).
* `POST /api/v1/documents/{id}/extract` — запуск `LLM #1` для парсинга.
* `POST /api/v1/recovery-plan/confirm` — создание плана после подтверждения данных пациентом.
* `POST /api/v1/checkin/message` — отправка сообщения/ответа в дневной чек-ин (вызов `LLM #2` -> `Rule Engine`).
* `GET /api/v1/doctor/summary/{patient_id}` — получение сгенерированного `LLM #3` анамнеза для врача.

---

## 4. Текущая структура и запуск

Рабочий интерфейс: React + TypeScript в `UI/`. API: Express в `server.ts`.
GigaChat обслуживает чат и генерацию расписания; OCR выполняется в `ocrtest.py`
через `python-runtime.ts`. Парсинг расписания находится в `schedule-json.ts`.
Архитектурные разделы выше описывают проектное направление, а не полностью
реализованную систему хранения, авторизации или триажа.

Streamlit (`app.py`) и старый корневой React-интерфейс удалены. Streamlit доступен
в истории Git, например в коммите `1e51bea`; переписывать историю не требуется.

### Установка (из корня репозитория)

Требуются Node.js с npm и Python 3. Node-зависимости обоих пакетов управляются
npm workspaces и единым корневым `package-lock.json`:

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Windows (PowerShell), также из корня:

```powershell
npm ci
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Существующий `.env` сохранён и намеренно отслеживается Git. Не заменяйте его.
Для нового окружения используйте корневой `.env.example` как шаблон настроек
GigaChat. При использовании виртуального окружения задайте `PYTHON_EXECUTABLE`
в корневом `.env` как абсолютный путь к `.venv/bin/python` (macOS/Linux) или
`.venv\Scripts\python.exe` (Windows). Без этой настройки сервер ищет системный
Python (`python3`/`python`, в Windows также `py -3`).

При первом OCR модели загружаются из Hugging Face; нужен доступ к сети.
Шаблон `UI/.env.example` оставлен как исторический файл: Gemini-настройки
активному приложению не нужны. Все рабочие настройки сервера находятся в корне.

### Разработка: два отдельных терминала

Backend — команда выполняется **из корня репозитория**:

```bash
npm run dev:backend
```

Express слушает `http://localhost:3000`. Backend больше не запускает Vite.

Frontend — команда выполняется **из каталога `UI/`**:

```bash
cd UI
npm run dev:frontend
```

Откройте `http://localhost:5173`. Порт фиксирован: если он занят, Vite завершится
с ошибкой. Запросы `/api` проксируются на `http://localhost:3000`.
Совместной команды запуска нет.

### Сборка и проверки (из корня репозитория)

```bash
npm run build
npm run typecheck:backend
npm run typecheck:frontend
```

Корневая конфигурация Vite собирает `UI/` в корневой `dist/`.
Команда `npm run build` из `UI/` использует тот же каталог вывода.
Для просмотра сборки из `UI/`: `npm run preview`; для API используйте backend.
В production Express может раздавать корневой `dist/`:

```bash
NODE_ENV=production npm run start:backend
```

Команда выполняется из корня. В PowerShell: `$env:NODE_ENV="production"`, затем
`npm run start:backend`. Production frontend и `/api` доступны на порту 3000.

Используемые API: `POST /api/chat`, `POST /api/ocr?extension=pdf` (или допустимое
изображение, бинарное тело с `Content-Type: application/octet-stream`) и
`POST /api/generate-schedule`. Без настроенных учётных данных GigaChat сохранены
демо-ответ чата; демонстрационный график не сохраняется в базе.

### Исходные архивы

Для архива исходников используйте `git archive` с правилами `.gitattributes`.
Они исключают зависимости, сборки, Python-кэши, виртуальные окружения,
настройки редакторов и метаданные ОС. `.gitignore` предотвращает их повторное
добавление. Локальные зависимости и настройки редакторов остаются на диске.
`.env` и `.env.example` включаются намеренно. Каталог `.git` не изменяется
и не удаляется; `git archive` экспортирует исходники без служебной базы Git.

## 5. PostgreSQL, вход и сохранение плана

Backend использует `pg` (общий пул), Argon2id и серверные сессии. Корневой `.env`
остаётся отслеживаемым; его значения не меняются автоматически. Требуемые имена
настроек: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
Для Postgres.app: localhost, 5432, recovery_dev, recovery_app; пароль укажите
только локально. Дополнительные настройки: `APP_ORIGINS` (точные разрешённые
HTTP/HTTPS origins через запятую), `COOKIE_SECURE` (`false` только для локального
HTTP, `true` для HTTPS; обязательно `true` в production). Настройки GigaChat и
`PYTHON_EXECUTABLE` остаются прежними. Backend проверяет конфигурацию и версии
миграций до запуска HTTP-сервера; ошибки не содержат значений настроек.

### Миграции

`db/migrations/001_initial_schema.sql` сохранён без изменений. Повторно применять
его к рабочей базе не нужно. `002_confirmed_instructions.sql` добавляет только
`plans.confirmed_instructions`: полные инструкции после подтверждения пациентом,
включая рекомендации без календарных событий. Исходные OCR-черновики сюда не
записываются. Миграция 002 уже применена к локальной базе в этой рабочей сессии.
Для другого окружения примените только недостающую 002 из корня:

```bash
node --import tsx scripts/migrate.ts
```

Скрипт читает локальный `.env`, проверяет наличие версии 001 и выполняет только
002; он не создаёт и не сбрасывает базу данных. Пароль не передаётся аргументом
командной строки. Установка и запуск остаются раздельными:

```bash
# Из корня
npm ci
npm run dev:backend

# В другом терминале, из UI/
npm run dev:frontend
```

OCR-зависимости: из корня `python3 -m venv .venv`, затем
`.venv/bin/python -m pip install -r requirements.txt`. Укажите абсолютный путь
этого интерпретатора в `PYTHON_EXECUTABLE`, если системный Python не имеет этих
зависимостей. Откройте http://localhost:5173; API работает на порту 3000.

### Работа пациента

1. Зарегистрируйтесь по email или телефону с явным международным кодом `+...`.
   Имя может повторяться; контакт уникален. Пароль: 8–256 символов. Часовой пояс
   IANA берётся из настроек браузера и проверяется сервером.
2. Выберите существующий эпизод либо операцию и нажмите «Создать эпизод».
   Загрузка документа сама по себе не создаёт эпизод.
3. Загрузите PDF/изображение, проверьте и при необходимости отредактируйте текст,
   явно укажите дату начала курса и подтвердите текст.
4. Проверьте все инструкции, даты и время. Для возможных конфликтов выберите:
   оставить прежнее назначение, подтвердить отдельный курс либо заменить
   невыполненные задачи с сохранением выполненной истории.
5. Подтвердите и сохраните план. Отметки задач сохраняются сразу; календарь в
   панели задач позволяет выбрать дату. Полный план доступен в аккаунте.

Одна сессия действует 7 дней, хранится в HttpOnly/SameSite=Lax cookie; в базе
находится только SHA-256 токена. Все изменяющие запросы требуют разрешённый
`Origin`, включая регистрацию/вход и локальные HTTP-проверки. Авторизация
проверяет владельца на сервере; идентификатор пациента из браузера не используется.

Обработка файла сохраняет только SHA-256 и состояние попытки. OCR-текст, имя и
байты файла не сохраняются; временный файл удаляется даже при ошибке. Черновики
живут в памяти до 30 минут и теряются при перезапуске backend. После перезапуска
незавершённая попытка освобождается по истечении этого срока; ошибочную попытку
можно повторить без дублирования upload_records. Повтор сохранённого файла
возвращает текущий план с существующими отметками выполнения.

Совпадение полного нормализованного назначения с пересекающимся диапазоном дат
расширяет существующий курс только недостающими событиями. Разные диапазоны и
изменения текста проходят подтверждение; клиническая эквивалентность не выводится
из ответа LLM. Одинаковое название не является ключом дедупликации. Возможные
конфликты определяются консервативно по названиям и общим словам и всегда решаются
пациентом. Неизвестные дозы, частоты и интервалы остаются NULL. События без времени
поддерживаются адаптером; существующий генератор GigaChat сохраняет отсутствующее время как NULL. Одинаковое название и время не
скрывают разные описания назначений при проверке конфликтов. Демо-расписание никогда не сохраняется.

Контекст чата берётся из сохранённых назначений выбранного эпизода. История чата
и пользовательский аватар пока временные; аватар не добавляется в схему базы.

### API

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/auth/register` | `{username,email?,phone?,password,timezone}` |
| POST | `/api/auth/login` | `{contact,password}` |
| POST | `/api/auth/logout` | Отзыв текущей сессии |
| GET | `/api/auth/me` | Текущий пациент или null |
| PATCH | `/api/patient` | Изменение `{username}` |
| GET / POST | `/api/cases` | Список / создание `{procedureName,startDate?}` |
| GET | `/api/cases/:caseId/plan` | План, назначения, все события |
| GET | `/api/cases/:caseId/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | Календарный диапазон (по умолчанию сегодня в часовом поясе пациента) |
| PATCH | `/api/events/:eventId` | `{completed:boolean}` |
| POST | `/api/cases/:caseId/tasks` | Подтверждённая пользовательская задача `{text,date}` |
| POST | `/api/ocr?caseId=UUID&extension=pdf` | Бинарное тело; временный `{draftId,text}` либо `{existing:true,plan,prescriptions,events}` |
| DELETE | `/api/drafts/:draftId` | Отмена черновика |
| POST | `/api/generate-schedule` | `{draftId,confirmedText,startDate,model?}`; возвращает предварительный план с версией и конфликтами |
| POST | `/api/plans/confirm` | `{draftId,version,decisions?}`; сохраняет изменения атомарно |
| POST | `/api/chat` | `{caseId?,messages,model?}`; контекст читается из сохранённого плана |

Кроме `/api/auth/*`, API требует сессию. Решения по конфликтам передаются как
`{[key]: "keep" | "separate" | "replace"}`. Изменение версии плана возвращает 409;
повторите проверку расписания. Поля `patient_id` в запросах не авторизуют доступ.

### Проверки (из корня)

```bash
npm run build
npm run typecheck:backend
npm run typecheck:frontend
npm run test:persistence
```

`test:persistence` создаёт отдельный временный кластер PostgreSQL на свободном
loopback-порту и удаляет его после тестов. `recovery_dev` не получает тестовые
записи. По умолчанию используется Postgres.app; для другой установки задайте
`POSTGRES_BIN` на каталог с `initdb`, `pg_ctl`, `createdb`. Нужен Python 3.
Тесты используют фиктивный OCR/LLM для детерминированной проверки базы и API.
Для реального OCR/GigaChat в этом же изолированном кластере:

```bash
RUN_LIVE_PIPELINE=1 npm run test:persistence
```

Требуются существующие GigaChat-настройки и OCR-зависимости Python. Браузерная
проверка дополнительно запускается при `TEST_PLAYWRIGHT_MODULE`, указывающем
абсолютный путь к установленному `playwright/index.mjs`, и запущенном frontend
на 5173. Playwright не является зависимостью приложения; для проверки использована
отдельная временная установка. API-запросы тестового браузера перенаправляются в
изолированную тестовую базу. Без этой настройки браузерный тест пропускается.

Справочники библиотек: [транзакции node-postgres](https://node-postgres.com/features/transactions)
и [Argon2id](https://github.com/ranisalt/node-argon2#usage).
