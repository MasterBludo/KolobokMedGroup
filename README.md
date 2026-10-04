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

## 4. Первый коммит (Initial Commit — Базовый чат на Python + GigaChat)

На первом этапе реализовано минимальное диалоговое окно чата с пациентом на базе **Python (Streamlit)** и **GigaChat SDK**.

### Структура файлов первого коммита

* `README.md` — документация и архитектура проекта.
* `app.py` — минимальный фронтенд на Python (Streamlit) с диалоговым окном чата GigaChat.
* `requirements.txt` — список Python-зависимостей.
* `.env.example` — шаблон переменных окружения.

Кнопка **Upload Statement** принимает PDF или изображение выписки и заполняет поле рекомендаций текстом, распознанным существующим OCR-модулем `ocrtest.py`.

### Быстрый старт (Python)

1. Установите зависимости:
   ```bash
   pip install -r requirements.txt
   ```

2. Создайте файл `.env` и укажите ключ авторизации GigaChat:
   ```env
   GIGACHAT_CREDENTIALS=ваш_ключ_авторизации_gigachat
   ```

3. Запустите приложение:
   ```bash
   streamlit run app.py
   ```

## 5. Веб-интерфейс Recovery

React-интерфейс из `UI/` запускается вместе с Express API и Vite из корня проекта:

1. Установите зависимости Node.js: `npm install`.
2. Укажите учётные данные GigaChat в `.env` (см. `.env.example`).
3. Запустите `npm run dev` и откройте `http://localhost:3000`.

Чат, распознавание PDF и изображений и формирование задач используют API `/api/chat`,
`/api/ocr` и `/api/generate-schedule`. Для OCR также требуется Python и зависимости
из `requirements.txt`.
