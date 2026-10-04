import base64
import os
import uuid
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


def ask_gigachat(access_token: str, messages: list[dict], model: str = "GigaChat") -> str:
    """Отправляет историю диалога в GigaChat API и возвращает текст ответа."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
    }

    response = requests.post(CHAT_URL, headers=headers, json=payload, verify=False, timeout=60)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]


st.set_page_config(page_title="AI Recovery Chat", layout="centered")
st.title("Чат сопровождения пациента (GigaChat)")

# Инициализация истории сообщений в сессии
if "messages" not in st.session_state:
    st.session_state.messages = [
        {
            "role": "assistant",
            "content": "Здравствуйте! Я ваш цифровой помощник по восстановлению после операции. Как вы себя чувствуете сегодня?",
        }
    ]

# Отрисовка истории диалога
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.write(msg["content"])

# Поле ввода сообщения
if user_input := st.chat_input("Введите сообщение..."):
    # Сохраняем и показываем сообщение пользователя
    st.session_state.messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.write(user_input)

    # Запрос к GigaChat напрямую через requests
    credentials = get_gigachat_credentials()
    scope = clean_value(os.getenv("GIGACHAT_SCOPE")) or "GIGACHAT_API_PERS"
    model = clean_value(os.getenv("GIGACHAT_MODEL")) or "GigaChat"

    if not credentials:
        reply = "Ошибка: не заданы GIGACHAT_CREDENTIALS или пара GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET в файле .env"
    else:
        try:
            token = get_access_token(credentials, scope=scope)
            reply = ask_gigachat(token, st.session_state.messages, model=model)
        except requests.HTTPError as http_err:
            error_body = http_err.response.text if http_err.response is not None else str(http_err)
            reply = f"Ошибка HTTP от GigaChat ({http_err.response.status_code}): {error_body}"
        except Exception as e:
            reply = f"Ошибка обращения к GigaChat: {e}"

    # Сохраняем и показываем ответ ассистента
    st.session_state.messages.append({"role": "assistant", "content": reply})
    with st.chat_message("assistant"):
        st.write(reply)
