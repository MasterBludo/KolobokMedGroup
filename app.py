import base64
import json
import os
import re
import uuid
from datetime import date, datetime, timedelta
from typing import List, Optional, Tuple
import requests
import urllib3
import streamlit as st
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError, field_validator

from db import (
    init_db,
    get_db_engine_name,
    register_user,
    authenticate_user,
    save_protocol_and_schedule,
    get_user_schedule,
    get_user_protocols,
    update_schedule_status,
)

# Отключаем предупреждения о самоподписанном SSL-сертификате Минцифры
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Загружаем переменные из .env и инициализируем таблицы БД
load_dotenv(override=True)
init_db()

OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
CHAT_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"


# =====================================================================
# 1. СТРОГАЯ ВАЛИДАЦИЯ JSON (PYDANTIC) И РАЗВОРАЧИВАНИЕ ПОВТОРЕНИЙ
# =====================================================================

class ReminderItem(BaseModel):
    """
    Единый формат конечного напоминания в календаре (БЕЗ типов).
    Только 4 поля: конкретная дата (YYYY-MM-DD), время (HH:MM), название, описание.
    """
    date: str
    time: str
    title: str
    description: str

    @field_validator("date")
    @classmethod
    def validate_date_format(cls, v: str) -> str:
        v = v.strip()
        datetime.strptime(v, "%Y-%m-%d")
        return v

    @field_validator("time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        v = v.strip()
        parsed = datetime.strptime(v, "%H:%M")
        return parsed.strftime("%H:%M")

    @field_validator("title", "description")
    @classmethod
    def validate_non_empty(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Поле не может быть пустым")
        return cleaned


class ExtractedRuleItem(BaseModel):
    """
    Промежуточное правило, которое возвращает ИИ из текста выписки.
    Позволяет корректно развернуть длительные курсы (например, Кальций на 2 месяца = 60 дней)
    на каждую конкретную дату календаря без обрыва JSON из-за лимита токенов.
    """
    title: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    times: List[str] = Field(default_factory=lambda: ["09:00"])
    exact_date: Optional[str] = None
    start_offset_days: int = Field(default=0, ge=0, le=365)
    duration_days: int = Field(default=1, ge=1, le=180)
    interval_days: int = Field(default=1, ge=1, le=90)


class ExtractedScheduleResponse(BaseModel):
    rules: List[ExtractedRuleItem] = Field(default_factory=list)
    reminders: List[ReminderItem] = Field(default_factory=list)


def extract_json_string(raw_text: str) -> str:
    """Находит и очищает JSON-объект из ответа нейросети (убирает markdown ```json ... ``` и лишние запятые)."""
    cleaned = re.sub(r"```(?:json)?", "", raw_text, flags=re.IGNORECASE).replace("```", "").strip()
    match = re.search(r"\{[\s\S]*\}", cleaned)
    if not match:
        raise ValueError("В ответе модели не найден JSON-объект {...}")
    json_str = match.group(0)
    json_str = re.sub(r",\s*([}\]])", r"\1", json_str)
    return json_str


def expand_and_validate_schedule(raw_json_str: str, start_date: date) -> Tuple[dict, List[dict]]:
    """
    1. Парсит и валидирует JSON через Pydantic (ExtractedScheduleResponse).
    2. Разворачивает повторяющиеся рекомендации (например, курс кальция на 2 месяца / 60 дней
       или перевязки каждые 2 дня) в конкретные даты календаря YYYY-MM-DD.
    3. Возвращает кортеж: (валидированный_json_протокола_для_таблицы_protocols, список_записей_для_таблицы_schedule).
    """
    data = json.loads(raw_json_str)
    parsed = ExtractedScheduleResponse.model_validate(data)

    final_reminders: List[ReminderItem] = []

    for item in parsed.reminders:
        final_reminders.append(item)

    for rule in parsed.rules:
        if rule.exact_date:
            try:
                rule_start = datetime.strptime(rule.exact_date.strip(), "%Y-%m-%d").date()
            except ValueError:
                rule_start = start_date + timedelta(days=rule.start_offset_days)
        else:
            rule_start = start_date + timedelta(days=rule.start_offset_days)

        day_offset = 0
        while day_offset < rule.duration_days:
            current_date_str = (rule_start + timedelta(days=day_offset)).isoformat()
            for t in rule.times:
                try:
                    validated_item = ReminderItem(
                        date=current_date_str,
                        time=t,
                        title=rule.title,
                        description=rule.description,
                    )
                    final_reminders.append(validated_item)
                except ValidationError:
                    validated_item = ReminderItem(
                        date=current_date_str,
                        time="09:00",
                        title=rule.title,
                        description=rule.description,
                    )
                    final_reminders.append(validated_item)
            day_offset += max(1, rule.interval_days)

    if not final_reminders:
        raise ValueError("После валидации список напоминаний оказался пустым")

    unique_map = {}
    for r in final_reminders:
        key = (r.date, r.time, r.title)
        unique_map[key] = r.model_dump()

    sorted_list = list(unique_map.values())
    sorted_list.sort(key=lambda x: (x["date"], x["time"], x["title"]))

    validated_protocol_json = {
        "start_date": start_date.isoformat(),
        "rules": [r.model_dump() for r in parsed.rules],
        "total_reminders": len(sorted_list),
    }
    return validated_protocol_json, sorted_list


# =====================================================================
# 2. РАБОТА С GIGACHAT API (АВТОРИЗАЦИЯ И ЗАПРОСЫ С ПОДДЕРЖКОЙ GIGACHAT-PRO)
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


def call_gigachat_with_fallback(
    access_token: str,
    messages: list[dict],
    preferred_model: str = "GigaChat-Pro",
    temperature: float = 0.2,
) -> tuple[str, str]:
    """
    Вызывает выбранную мощную модель (например, GigaChat-Pro или GigaChat-Max).
    Если на бесплатном тарифе пользователя нет токенов для GigaChat-Pro,
    автоматически переключается на базовую модель GigaChat.
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
    }

    models_to_try = [preferred_model]
    if preferred_model != "GigaChat":
        models_to_try.append("GigaChat")

    last_error = None
    for current_model in models_to_try:
        payload = {
            "model": current_model,
            "messages": messages,
            "temperature": temperature,
        }
        response = requests.post(CHAT_URL, headers=headers, json=payload, verify=False, timeout=60)
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"], current_model
        last_error = f"HTTP {response.status_code}: {response.text}"

    raise RuntimeError(f"Ошибка GigaChat API: {last_error}")


def ask_gigachat(
    access_token: str,
    messages: list[dict],
    recommendations_text: str = "",
    model: str = "GigaChat-Pro",
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
    reply, _ = call_gigachat_with_fallback(
        access_token,
        [system_prompt] + messages,
        preferred_model=model,
        temperature=0.5,
    )
    return reply


def generate_schedule_once_from_recommendations(
    access_token: str,
    recommendations_text: str,
    start_date: date,
    model: str = "GigaChat-Pro",
) -> tuple[dict, List[dict], str]:
    """
    1. Отправляет текст выписки в GigaChat-Pro.
    2. Проводит строгую валидацию JSON через Pydantic.
    3. Возвращает (validated_protocol_json, validated_reminders, used_model) для сохранения в БД.
    """
    today_str = start_date.isoformat()

    base_prompt = f"""Ты — медицинский ИИ-ассистент. Пациент после операции при переломе прикрепил список рекомендаций врача.
Дата начала отсчёта (сегодня): {today_str}.

Твоя задача — извлечь ВСЕ рекомендации (приём лекарств, кальция, перевязки, снятие повязок/швов, плановый приём врача) в структурированный JSON.
Чтобы расписание на длительный срок (например, курс кальция на 1–2 месяца = 30–60 дней) гарантированно повторилось в календаре на каждый нужный день, используй массив "rules":

Поля каждого элемента в "rules":
- "title": краткое название (строка, например: "Кальций Д3 Никомед" или "Плановый приём травматолога").
- "description": понятное описание что нужно сделать (строка).
- "times": список времени в формате "HH:MM" (например, ["09:00", "20:00"] для двукратного приёма или ["11:00"] для разового события).
- "start_offset_days": через сколько дней от {today_str} начинается действие (0 — если с сегодняшнего дня; 10 — если через 10 дней).
- "duration_days": сколько всего дней длится курс (например: 60 — если назначено на 2 месяца; 30 — если на 1 месяц; 1 — если это разовый визит к врачу или разовое снятие швов).
- "interval_days": шаг повторения в днях (1 — если каждый день; 2 — если каждые 2 дня; 7 — если раз в неделю).

Верни ТОЛЬКО валидный JSON строго следующего формата (никакого текста до или после JSON):
{{
  "rules": [
    {{
      "title": "Кальций Д3 Никомед",
      "description": "Принять 1 таблетку во время еды (курс 2 месяца)",
      "times": ["09:00", "20:00"],
      "start_offset_days": 0,
      "duration_days": 60,
      "interval_days": 1
    }}
  ]
}}

Список рекомендаций пациента:
{recommendations_text}
"""

    messages = [{"role": "user", "content": base_prompt}]
    used_model = model

    for attempt in range(2):
        raw_reply, used_model = call_gigachat_with_fallback(
            access_token,
            messages,
            preferred_model=model,
            temperature=0.1,
        )
        try:
            clean_json = extract_json_string(raw_reply)
            protocol_json, validated_reminders = expand_and_validate_schedule(
                clean_json, start_date=start_date
            )
            protocol_json["model"] = used_model
            return protocol_json, validated_reminders, used_model
        except Exception as validation_err:
            if attempt == 0:
                messages.append({"role": "assistant", "content": raw_reply})
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            f"Твой ответ не прошёл валидацию JSON: {validation_err}. "
                            "Верни ТОЛЬКО исправленный валидный JSON с массивом 'rules' по схеме."
                        ),
                    }
                )
            else:
                raise ValueError(f"Ошибка валидации JSON от модели: {validation_err}")

    raise ValueError("Не удалось сформировать валидное расписание")


# =====================================================================
# 3. ИНИЦИАЛИЗАЦИЯ СОСТОЯНИЯ СЕССИИ (SESSION STATE)
# =====================================================================

if "current_user" not in st.session_state:
    st.session_state.current_user = None

if "messages" not in st.session_state:
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": (
                "Здравствуйте! Я ваш помощник по послеоперационному сопровождению при переломах. "
                "Прикрепите справа список рекомендаций из вашей выписки, чтобы я сформировал "
                "и сохранил в базу данных ваш протокол (JSON) и календарное расписание."
            ),
        }
    ]

if "used_model_name" not in st.session_state:
    st.session_state.used_model_name = clean_value(os.getenv("GIGACHAT_MODEL")) or "GigaChat-Pro"


# =====================================================================
# 4. ИНТЕРФЕЙС АВТОРИЗАЦИИ И ПРИЛОЖЕНИЯ (STREAMLIT)
# =====================================================================

st.set_page_config(page_title="AI Fracture Recovery + DB", layout="wide")
st.title("Послеоперационное сопровождение при переломах (GigaChat-Pro + БД)")
st.caption(f"Активное хранилище: {get_db_engine_name()} · Таблицы: users, protocols, schedule")

# Если пользователь не авторизован — показываем форму Входа / Регистрации
if st.session_state.current_user is None:
    st.subheader("Авторизация пациента")
    tab_login, tab_register = st.tabs(["Вход в систему", "Регистрация нового пользователя"])

    with tab_login:
        with st.form("login_form"):
            login_id = st.text_input("Логин или телефон", placeholder="ivan_petrov или +79991234567")
            login_pwd = st.text_input("Пароль", type="password")
            submit_login = st.form_submit_button("Войти")
            if submit_login:
                try:
                    user = authenticate_user(login_id, login_pwd)
                    st.session_state.current_user = user
                    st.rerun()
                except Exception as err:
                    st.error(str(err))

    with tab_register:
        with st.form("register_form"):
            reg_login = st.text_input("Логин (уникальный)", placeholder="ivan_petrov")
            reg_phone = st.text_input("Телефон (уникальный)", placeholder="+79991234567")
            reg_pwd = st.text_input("Пароль", type="password")
            submit_reg = st.form_submit_button("Зарегистрироваться")
            if submit_reg:
                try:
                    user = register_user(reg_login, reg_phone, reg_pwd)
                    st.session_state.current_user = user
                    st.success("Регистрация успешно завершена!")
                    st.rerun()
                except Exception as err:
                    st.error(str(err))

    st.stop()

# Если пользователь вошёл в систему
current_user = st.session_state.current_user
user_id = current_user["id"]

top_col1, top_col2, top_col3 = st.columns([2, 1, 1])
with top_col1:
    st.markdown(
        f"**Пациент:** `{current_user['login']}` · **Телефон:** `{current_user['phone']}` · **ID в БД:** `{user_id}`"
    )
with top_col2:
    selected_model = st.selectbox(
        "Модель GigaChat:",
        options=["GigaChat-Pro", "GigaChat-Max", "GigaChat"],
        index=0,
    )
with top_col3:
    if st.button("Выйти из аккаунта"):
        st.session_state.current_user = None
        st.rerun()

user_protocols = get_user_protocols(user_id)
user_schedule = get_user_schedule(user_id)
latest_protocol_text = user_protocols[0]["raw_text"] if user_protocols else ""

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

        if not credentials:
            reply = "Ошибка: не заданы ключи GigaChat в файле .env"
        else:
            try:
                token = get_access_token(credentials, scope=scope)
                reply = ask_gigachat(
                    token,
                    st.session_state.messages,
                    recommendations_text=latest_protocol_text,
                    model=selected_model,
                )
            except Exception as e:
                reply = f"Ошибка обращения к GigaChat: {e}"

        st.session_state.messages.append({"role": "assistant", "content": reply})
        with st.chat_message("assistant"):
            st.write(reply)

# --- ПРАВАЯ КОЛОНКА: ПРОТОКОЛЫ (JSON В БД) И РАСПИСАНИЕ (ТАБЛИЦА SCHEDULE) ---
with col_schedule:
    st.subheader("2. Протоколы и календарное расписание (БД)")

    with st.expander("➕ Загрузить новый протокол (выписку) в БД", expanded=(len(user_schedule) == 0)):
        uploaded_file = st.file_uploader("Прикрепить файл рекомендаций (.txt)", type=["txt"])
        default_sample = (
            "Выписка: Операция остеосинтеза лодыжки.\n"
            "Рекомендации:\n"
            "1. Кальций Д3 Никомед — по 1 таблетке утром (09:00) и вечером (20:00) ежедневно в течение 2 месяцев (60 дней).\n"
            "2. Кеторол — 1 таблетка в 13:00 при болях первые 3 дня.\n"
            "3. Перевязка и обработка шва антисептиком — каждые 2 дня в течение 10 дней.\n"
            "4. Снятие повязки и швов — через 10 дней.\n"
            "5. Плановый приём травматолога и контрольный рентген — через 14 дней."
        )
        text_from_file = uploaded_file.read().decode("utf-8", errors="ignore") if uploaded_file else ""
        rec_input = st.text_area(
            "Текст рекомендаций из выписки:",
            value=text_from_file if text_from_file else default_sample,
            height=140,
        )

        if st.button("Сформировать JSON протокола и сохранить расписание в БД"):
            credentials = get_gigachat_credentials()
            scope = clean_value(os.getenv("GIGACHAT_SCOPE")) or "GIGACHAT_API_PERS"

            if not credentials:
                st.error("Ошибка: не заданы ключи GigaChat в файле .env")
            elif not rec_input.strip():
                st.warning("Добавьте текст рекомендаций.")
            else:
                with st.spinner("ИИ формирует JSON протокола, валидирует и сохраняет в БД..."):
                    try:
                        token = get_access_token(credentials, scope=scope)
                        protocol_json, reminders_list, used_model = generate_schedule_once_from_recommendations(
                            token,
                            rec_input.strip(),
                            start_date=date.today(),
                            model=selected_model,
                        )
                        save_protocol_and_schedule(
                            user_id=user_id,
                            raw_text=rec_input.strip(),
                            protocol_json=protocol_json,
                            reminders=reminders_list,
                        )
                        st.session_state.used_model_name = used_model
                        st.rerun()
                    except Exception as e:
                        st.error(f"Ошибка генерации и сохранения: {e}")

    if user_protocols:
        with st.expander(f"📄 Сохранённые в БД протоколы JSON (всего: {len(user_protocols)})", expanded=False):
            for proto in user_protocols:
                st.markdown(f"**Протокол #{proto['id']}** (загружен: `{proto['uploaded_at']}`)")
                st.json(proto["protocol"])

    if user_schedule:
        st.success(f"В базе данных сохранено записей расписания: {len(user_schedule)}")

        show_all = st.checkbox("Показать все даты единым списком", value=False)
        selected_date_str = st.date_input("Выберите дату в календаре:", value=date.today()).isoformat()

        filtered_schedule = [
            r for r in user_schedule
            if show_all or r.get("date") == selected_date_str
        ]

        if not filtered_schedule:
            st.write(f"На дату {selected_date_str} записей в таблице schedule нет.")
        else:
            status_labels = {
                "waiting": "⏳ Ожидает (waiting)",
                "performed": "✅ Выполнено (performed)",
                "skipped": "⏭️ Пропущено (skipped)",
            }
            current_date_header = None
            for item in filtered_schedule:
                item_date = item.get("date", "")
                if item_date != current_date_header:
                    current_date_header = item_date
                    st.markdown(f"#### 📅 {current_date_header}")

                c1, c2 = st.columns([3, 2])
                with c1:
                    st.markdown(
                        f"**{item.get('time', '--:--')}** — **{item.get('procedure', '')}**  \n"
                        f"<span style='color:gray;font-size:0.9em'>{item.get('description', '')}</span>",
                        unsafe_allow_html=True,
                    )
                with c2:
                    current_st = item.get("proc_status", "waiting")
                    options = ["waiting", "performed", "skipped"]
                    new_st = st.selectbox(
                        "Статус",
                        options=options,
                        index=options.index(current_st) if current_st in options else 0,
                        format_func=lambda x: status_labels.get(x, x),
                        key=f"status_{item['id']}",
                        label_visibility="collapsed",
                    )
                    if new_st != current_st:
                        update_schedule_status(item["id"], user_id, new_st)
                        st.rerun()
