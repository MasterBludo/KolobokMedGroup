import base64
import json
import os
import re
import uuid
from datetime import date, timedelta
import requests
import urllib3
import streamlit as st
from dotenv import load_dotenv

# Отключаем предупреждения о самоподписанном SSL-сертификате Минцифры
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Загружаем переменные из .env
load_dotenv(override=True)

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"


# =====================================================================
# 1. РАБОТА С GIGACHAT API (АВТОРИЗАЦИЯ И ЗАПРОСЫ)
# =====================================================================

def clean_value(val: str | None) -> str:
    """Убирает лишние пробелы, кавычки и префикс Basic."""
    if not val:
        return ""
    cleaned = val.strip().strip('"').strip("'").strip()
    if cleaned.lower().startswith("basic "):
        cleaned = cleaned[6:].strip()
    return cleaned


def get_gigachat_credentials() -> str | None:
    """Возвращает Base64 Authorization Key из GIGACHAT_CREDENTIALS или кодирует Client ID:Client Secret."""
    credentials = clean_value(os.getenv("GIGACHAT_CREDENTIALS"))
    if credentials and credentials != "YOUR_GIGACHAT_AUTH_KEY":
        return credentials

    client_id = clean_value(os.getenv("GIGACHAT_CLIENT_ID"))
    client_secret = clean_value(os.getenv("GIGACHAT_CLIENT_SECRET"))
    if client_id and client_secret and client_id != "YOUR_CLIENT_ID":
        raw = f"{client_id}:{client_secret}".encode("utf-8")
        return base64.b64encode(raw).decode("utf-8")

    return None


def get_access_token(auth_key: str, scope: str = "GIGACHAT_API_PERS") -> str:
    """Получает временный Access Token через официальный OAuth-эндпоинт Сбера."""
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "RqUID": str(uuid.uuid4()),
        "Authorization": f"Basic {auth_key}",
    }
    payload = {"scope": scope}

    response = requests.post(OAUTH_URL, headers=headers, data=payload, verify=False, timeout=20)
    response.raise_for_status()
    return response.json()["access_token"]


def ask_gigachat(
    access_token: str,
    messages: list[dict],
    recommendations_text: str = "",
    model: str = "GigaChat",
) -> str:
    """Отправляет историю диалога в GigaChat API и возвращает текстовый ответ пациенту."""
    context_note = (
        f"\nПрикреплённые рекомендации пациента:\n{recommendations_text}"
        if recommendations_text
        else ""
    )
    system_prompt = {
        "role": "system",
        "content": (
            "Ты — медицинский цифровой помощник по послеоперационному сопровождению пациентов с переломами. "
            "Отвечай вежливо, кратко и понятно. Помогай пациенту по вопросам восстановления после перелома."
            + context_note
        ),
    }
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    payload = {
        "model": model,
        "messages": [system_prompt] + messages,
        "temperature": 0.5,
    }

    response = requests.post(CHAT_URL, headers=headers, json=payload, verify=False, timeout=60)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]


def generate_schedule_once_from_recommendations(
    access_token: str,
    recommendations_text: str,
    start_date: date,
    model: str = "GigaChat",
) -> list[dict]:
    """
    Вызывается ТОЛЬКО ОДИН РАЗ при прикреплении списка рекомендаций (выписки).
    Превращает текст рекомендаций в единый список напоминаний с КОНКРЕТНЫМИ датами календаря (YYYY-MM-DD).
    Каждое напоминание имеет одинаковую структуру без типов:
      - date: "YYYY-MM-DD" (конкретная дата в календаре)
      - time: "HH:MM" (время)
      - title: строка (название)
      - description: строка (описание)
    """
    today_str = start_date.isoformat()

    prompt = f"""Ты — медицинский ассистент. Пациент после операции при переломе прикрепил список рекомендаций врача.
Дата начала отсчёта (сегодня): {today_str}.

Сформируй расписание напоминаний в виде единого списка.
ВАЖНЫЕ ПРАВИЛА:
1. У напоминаний НЕТ типов и категорий. Напоминание о таблетке, кальции, перевязке или визите к врачу имеет строго одинаковые поля:
   - "date": конкретная дата в календаре в формате "YYYY-MM-DD" (например, "{today_str}"). Никаких фраз вроде "каждые 2 дня" или "через 10 дней" — высчитай точные календарные даты относительно {today_str}!
   - "time": конкретное время в формате "HH:MM" (например, "09:00").
   - "title": краткое название действия.
   - "description": понятное описание что именно нужно сделать.
2. Если назначен ежедневный приём препарата (например, кальций или обезболивающее), разверни его по конкретным датам календаря на ближайшие дни.
3. Если назначены перевязки, снятие повязок/швов и плановый приём врача — вычисли для каждого события точную дату "YYYY-MM-DD" от {today_str}.

Верни ТОЛЬКО валидный JSON строго следующего формата (без текста вокруг):
{{
  "reminders": [
    {{
      "date": "{today_str}",
      "time": "09:00",
      "title": "Кальций Д3",
      "description": "Принять 1 таблетку во время завтрака"
    }},
    {{
      "date": "{(start_date + timedelta(days=2)).isoformat()}",
      "time": "11:00",
      "title": "Смена повязки",
      "description": "Обработать послеоперационный шов антисептиком и сменить стерильную повязку"
    }},
    {{
      "date": "{(start_date + timedelta(days=10)).isoformat()}",
      "time": "14:00",
      "title": "Плановый приём травматолога",
      "description": "Контрольный рентген-снимок и снятие повязки/швов у врача"
    }}
  ]
}}

Список рекомендаций пациента:
{recommendations_text}
"""

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }

    response = requests.post(CHAT_URL, headers=headers, json=payload, verify=False, timeout=60)
    response.raise_for_status()
    raw_content = response.json()["choices"][0]["message"]["content"]

    match = re.search(r"\{[\s\S]*\}", raw_content)
    if match:
        parsed = json.loads(match.group(0))
        reminders = parsed.get("reminders", [])
        # Сортируем по конкретной дате и времени
        reminders.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
        return reminders

    raise ValueError("Не удалось распознать JSON со списком напоминаний")


# =====================================================================
# 2. ИНИЦИАЛИЗАЦИЯ СОСТОЯНИЯ (SESSION STATE)
# =====================================================================

if "messages" not in st.session_state:
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": (
                "Здравствуйте! Я ваш помощник по послеоперационному сопровождению при переломах. "
                "Прикрепите справа список рекомендаций из вашей выписки, чтобы я один раз сформировал "
                "точное календарное расписание, и задавайте любые вопросы в чате."
            ),
        }
    ]

# Единый список напоминаний: [{"date": "YYYY-MM-DD", "time": "HH:MM", "title": "...", "description": "..."}]
if "reminders" not in st.session_state:
    st.session_state.reminders = []

# Флаг того, что расписание уже было сформировано один раз при прикреплении рекомендаций
if "schedule_generated" not in st.session_state:
    st.session_state.schedule_generated = False

if "recommendations_text" not in st.session_state:
    st.session_state.recommendations_text = ""


# =====================================================================
# 3. ПРОСТОЙ ИНТЕРФЕЙС (UI STREAMLIT — 2 КОЛОНКИ)
# =====================================================================

st.set_page_config(page_title="AI Fracture Recovery", layout="wide")
st.title("Послеоперационное сопровождение при переломах (GigaChat)")

col_chat, col_schedule = st.columns([1, 1])

# --- ЛЕВАЯ КОЛОНКА: ДИАЛОГ С ПАЦИЕНТОМ ---
with col_chat:
    st.subheader("1. Диалог с пациентом")

    for msg in st.session_state.messages:
        with st.chat_message(msg["role"]):
            st.write(msg["content"])

    if user_input := st.chat_input("Введите вопрос..."):
        st.session_state.messages.append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.write(user_input)

        credentials = get_gigachat_credentials()
        scope = clean_value(os.getenv("GIGACHAT_SCOPE")) or "GIGACHAT_API_PERS"
        model = clean_value(os.getenv("GIGACHAT_MODEL")) or "GigaChat"

        if not credentials:
            reply = "Ошибка: не заданы ключи GigaChat в файле .env"
        else:
            try:
                token = get_access_token(credentials, scope=scope)
                reply = ask_gigachat(
                    token,
                    st.session_state.messages,
                    recommendations_text=st.session_state.recommendations_text,
                    model=model,
                )
            except Exception as e:
                reply = f"Ошибка обращения к GigaChat: {e}"

        st.session_state.messages.append({"role": "assistant", "content": reply})
        with st.chat_message("assistant"):
            st.write(reply)

# --- ПРАВАЯ КОЛОНКА: ПРИКРЕПЛЕНИЕ РЕКОМЕНДАЦИЙ И КАЛЕНДАРНОЕ РАСПИСАНИЕ ---
with col_schedule:
    st.subheader("2. Календарное расписание (Daily Check-in)")

    # Расписание формируется ИИ ТОЛЬКО ОДИН РАЗ при прикреплении списка рекомендаций
    if not st.session_state.schedule_generated:
        st.info("Прикрепите файл с рекомендациями врача (.txt) или вставьте текст выписки, чтобы ИИ сформировал календарное расписание.")

        uploaded_file = st.file_uploader("Прикрепить файл рекомендаций (.txt)", type=["txt"])
        default_sample = (
            "Выписка: Операция остеосинтеза лодыжки.\n"
            "Рекомендации:\n"
            "1. Кальций Д3 Никомед — по 1 таблетке утром (09:00) и вечером (20:00) ежедневно.\n"
            "2. Кеторол — 1 таблетка в 13:00 при болях первые 3 дня.\n"
            "3. Перевязка и обработка шва антисептиком — через 2 дня и через 4 дня.\n"
            "4. Снятие повязки и швов — через 10 дней.\n"
            "5. Плановый приём травматолога и контрольный рентген — через 14 дней."
        )
        text_from_file = uploaded_file.read().decode("utf-8", errors="ignore") if uploaded_file else ""
        rec_input = st.text_area(
            "Текст рекомендаций из выписки:",
            value=text_from_file if text_from_file else default_sample,
            height=150,
        )

        if st.button("Прикрепить рекомендации и сформировать расписание"):
            credentials = get_gigachat_credentials()
            scope = clean_value(os.getenv("GIGACHAT_SCOPE")) or "GIGACHAT_API_PERS"
            model = clean_value(os.getenv("GIGACHAT_MODEL")) or "GigaChat"

            if not credentials:
                st.error("Ошибка: не заданы ключи GigaChat в файле .env")
            elif not rec_input.strip():
                st.warning("Добавьте текст рекомендаций.")
            else:
                with st.spinner("ИИ формирует расписание по конкретным датам календаря..."):
                    try:
                        token = get_access_token(credentials, scope=scope)
                        st.session_state.reminders = generate_schedule_once_from_recommendations(
                            token,
                            rec_input.strip(),
                            start_date=date.today(),
                            model=model,
                        )
                        st.session_state.recommendations_text = rec_input.strip()
                        st.session_state.schedule_generated = True
                        st.rerun()
                    except Exception as e:
                        st.error(f"Ошибка генерации расписания: {e}")
    else:
        st.success("Рекомендации прикреплены. Расписание сформировано по конкретным датам календаря.")

        # Фильтр по дате календаря или показ всех дат
        show_all = st.checkbox("Показать все запланированные даты календаря", value=True)
        selected_date = None
        if not show_all:
            selected_date = st.date_input("Выберите дату в календаре:", value=date.today()).isoformat()

        filtered_reminders = [
            r for r in st.session_state.reminders
            if show_all or r.get("date") == selected_date
        ]

        if not filtered_reminders:
            st.write("На выбранную дату напоминаний нет.")
        else:
            current_date_header = None
            for idx, item in enumerate(filtered_reminders):
                item_date = item.get("date", "")
                if item_date != current_date_header:
                    current_date_header = item_date
                    st.markdown(f"#### 📅 {current_date_header}")

                label = f"**{item.get('time', '--:--')}** — **{item.get('title', '')}**  \n{item.get('description', '')}"
                st.checkbox(label, key=f"rem_{idx}_{item_date}_{item.get('time', '')}_{item.get('title', '')}")
