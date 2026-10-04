import base64
import os
import streamlit as st
from dotenv import load_dotenv
from gigachat import GigaChat
from gigachat.models import Chat, Messages, MessagesRole

load_dotenv()


def get_gigachat_credentials() -> str | None:
    """Возвращает Base64 Authorization Key из GIGACHAT_CREDENTIALS или кодирует пару Client ID:Client Secret."""
    credentials = os.getenv("GIGACHAT_CREDENTIALS")
    if credentials and credentials != "YOUR_GIGACHAT_AUTH_KEY":
        return credentials

    client_id = os.getenv("GIGACHAT_CLIENT_ID")
    client_secret = os.getenv("GIGACHAT_CLIENT_SECRET")
    if client_id and client_secret and client_id != "YOUR_CLIENT_ID":
        raw = f"{client_id}:{client_secret}".encode("utf-8")
        return base64.b64encode(raw).decode("utf-8")

    return None


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

    # Запрос к GigaChat
    credentials = get_gigachat_credentials()
    scope = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")

    if not credentials:
        reply = "Ошибка: не заданы GIGACHAT_CREDENTIALS или пара GIGACHAT_CLIENT_ID / GIGACHAT_CLIENT_SECRET в файле .env"
    else:
        try:
            sdk_messages = [
                Messages(
                    role=MessagesRole.USER if m["role"] == "user" else MessagesRole.ASSISTANT,
                    content=m["content"],
                )
                for m in st.session_state.messages
            ]
            with GigaChat(credentials=credentials, scope=scope, verify_ssl_certs=False) as giga:
                response = giga.chat(Chat(messages=sdk_messages))
                reply = response.choices[0].message.content
        except Exception as e:
            reply = f"Ошибка обращения к GigaChat: {e}"

    # Сохраняем и показываем ответ ассистента
    st.session_state.messages.append({"role": "assistant", "content": reply})
    with st.chat_message("assistant"):
        st.write(reply)
