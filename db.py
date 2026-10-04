import hashlib
import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv(override=True)

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    psycopg2 = None
    RealDictCursor = None

VALID_STATUSES = ("waiting", "skipped", "performed")
SQLITE_DB_PATH = Path(__file__).resolve().parent / "recovery_local.db"
SCHEMA_SQL_PATH = Path(__file__).resolve().parent / "schema.sql"


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Хеширование пароля через PBKDF2-HMAC-SHA256 с солью."""
    if not salt:
        salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    )
    return f"pbkdf2_sha256${salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Проверка пароля по сохранённому хешу."""
    if not stored_hash or "$" not in stored_hash:
        return False
    parts = stored_hash.split("$")
    if len(parts) != 3:
        return False
    _, salt, _ = parts
    expected = hash_password(password, salt=salt)
    return secrets.compare_digest(expected, stored_hash)


def get_pg_connection():
    """Пробует подключиться к PostgreSQL по переменным из .env."""
    if psycopg2 is None:
        return None

    database_url = os.getenv("DATABASE_URL", "").strip()
    db_host = os.getenv("DB_HOST", "").strip()
    db_port = os.getenv("DB_PORT", "5432").strip()
    db_name = os.getenv("DB_NAME", "").strip()
    db_user = os.getenv("DB_USER", "").strip()
    db_password = os.getenv("DB_PASSWORD", "").strip()

    if not database_url and not (db_host and db_name and db_user):
        return None

    try:
        if database_url:
            conn = psycopg2.connect(database_url, connect_timeout=3)
        else:
            conn = psycopg2.connect(
                host=db_host,
                port=int(db_port or 5432),
                dbname=db_name,
                user=db_user,
                password=db_password,
                connect_timeout=3,
            )
        return conn
    except Exception:
        return None


def get_sqlite_connection() -> sqlite3.Connection:
    """Резервное локальное подключение SQLite, если PostgreSQL не настроен."""
    conn = sqlite3.connect(str(SQLITE_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def get_db_engine_name() -> str:
    """Возвращает активный движок БД: PostgreSQL или SQLite (локальный резерв)."""
    pg_conn = get_pg_connection()
    if pg_conn is not None:
        pg_conn.close()
        return "PostgreSQL"
    return "SQLite (локальный файл recovery_local.db)"


def init_db() -> str:
    """
    Инициализирует структуру БД (users, protocols, schedule, тип status).
    Если доступен PostgreSQL — выполняет schema.sql.
    Иначе создаёт эквивалентные таблицы в локальном SQLite.
    """
    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn:
                with pg_conn.cursor() as cur:
                    schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
                    cur.execute(schema_sql)
            return "PostgreSQL"
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        with conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    phone VARCHAR(20) NOT NULL UNIQUE,
                    login VARCHAR(50) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    registered_at TEXT NOT NULL,
                    last_login_at TEXT
                );

                CREATE TABLE IF NOT EXISTS protocols (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    raw_text TEXT NOT NULL DEFAULT '',
                    protocol TEXT NOT NULL DEFAULT '{}',
                    uploaded_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
                );

                CREATE TABLE IF NOT EXISTS schedule (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    protocol_id INTEGER,
                    procedure VARCHAR(255) NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    time_to_do TEXT NOT NULL,
                    proc_status TEXT NOT NULL DEFAULT 'waiting' CHECK(proc_status IN ('waiting', 'skipped', 'performed')),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
                    FOREIGN KEY (protocol_id) REFERENCES protocols(id) ON UPDATE CASCADE ON DELETE SET NULL
                );
                """
            )
        return "SQLite"
    finally:
        conn.close()


def register_user(login: str, phone: str, password: str) -> Dict[str, Any]:
    """Регистрирует нового пользователя в таблице users."""
    clean_login = login.strip()
    clean_phone = phone.strip()
    if not clean_login or not clean_phone or not password:
        raise ValueError("Заполните логин, телефон и пароль")
    if len(clean_login) > 50:
        raise ValueError("Логин не должен превышать 50 символов")
    if len(clean_phone) > 20:
        raise ValueError("Телефон не должен превышать 20 символов")

    pwd_hash = hash_password(password)
    now_iso = datetime.now(timezone.utc).isoformat()

    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn:
                with pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        "SELECT id FROM users WHERE login = %s OR phone = %s",
                        (clean_login, clean_phone),
                    )
                    if cur.fetchone():
                        raise ValueError("Пользователь с таким логином или телефоном уже существует")

                    cur.execute(
                        """
                        INSERT INTO users (phone, login, password_hash, registered_at, last_login_at)
                        VALUES (%s, %s, %s, NOW(), NOW())
                        RETURNING id, phone, login, registered_at, last_login_at
                        """,
                        (clean_phone, clean_login, pwd_hash),
                    )
                    row = dict(cur.fetchone())
                    row["registered_at"] = str(row["registered_at"])
                    row["last_login_at"] = str(row["last_login_at"]) if row["last_login_at"] else None
                    return row
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        with conn:
            cur = conn.execute(
                "SELECT id FROM users WHERE login = ? OR phone = ?",
                (clean_login, clean_phone),
            )
            if cur.fetchone():
                raise ValueError("Пользователь с таким логином или телефоном уже существует")

            cur = conn.execute(
                """
                INSERT INTO users (phone, login, password_hash, registered_at, last_login_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (clean_phone, clean_login, pwd_hash, now_iso, now_iso),
            )
            user_id = cur.lastrowid
            return {
                "id": user_id,
                "phone": clean_phone,
                "login": clean_login,
                "registered_at": now_iso,
                "last_login_at": now_iso,
            }
    finally:
        conn.close()


def authenticate_user(login_or_phone: str, password: str) -> Dict[str, Any]:
    """Проверяет учётные данные пользователя и обновляет last_login_at."""
    identifier = login_or_phone.strip()
    if not identifier or not password:
        raise ValueError("Введите логин (или телефон) и пароль")

    now_iso = datetime.now(timezone.utc).isoformat()

    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn:
                with pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id, phone, login, password_hash, registered_at, last_login_at
                        FROM users
                        WHERE login = %s OR phone = %s
                        """,
                        (identifier, identifier),
                    )
                    user = cur.fetchone()
                    if not user or not verify_password(password, user["password_hash"]):
                        raise ValueError("Неверный логин/телефон или пароль")

                    cur.execute(
                        """
                        UPDATE users
                        SET last_login_at = NOW()
                        WHERE id = %s
                        RETURNING id, phone, login, registered_at, last_login_at
                        """,
                        (user["id"],),
                    )
                    updated = dict(cur.fetchone())
                    updated["registered_at"] = str(updated["registered_at"])
                    updated["last_login_at"] = str(updated["last_login_at"])
                    return updated
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        with conn:
            cur = conn.execute(
                """
                SELECT id, phone, login, password_hash, registered_at, last_login_at
                FROM users
                WHERE login = ? OR phone = ?
                """,
                (identifier, identifier),
            )
            row = cur.fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                raise ValueError("Неверный логин/телефон или пароль")

            conn.execute(
                "UPDATE users SET last_login_at = ? WHERE id = ?",
                (now_iso, row["id"]),
            )
            return {
                "id": row["id"],
                "phone": row["phone"],
                "login": row["login"],
                "registered_at": row["registered_at"],
                "last_login_at": now_iso,
            }
    finally:
        conn.close()


def save_protocol_and_schedule(
    user_id: int,
    raw_text: str,
    protocol_json: Dict[str, Any],
    reminders: List[Dict[str, str]],
) -> Dict[str, Any]:
    """
    1. Сохраняет валидированный JSON протокола в таблицу `protocols`.
    2. Сохраняет развёрнутое расписание в таблицу `schedule` со статусом 'waiting'.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    protocol_str = json.dumps(protocol_json, ensure_ascii=False)

    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn:
                with pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        """
                        INSERT INTO protocols (user_id, raw_text, protocol, uploaded_at)
                        VALUES (%s, %s, %s::jsonb, NOW())
                        RETURNING id, user_id, raw_text, protocol, uploaded_at
                        """,
                        (user_id, raw_text, protocol_str),
                    )
                    protocol_row = dict(cur.fetchone())
                    protocol_id = protocol_row["id"]

                    for item in reminders:
                        date_part = item.get("date", "2026-01-01")
                        time_part = item.get("time", "09:00")
                        time_to_do = f"{date_part}T{time_part}:00+00:00"
                        proc_title = (item.get("title") or item.get("procedure") or "Процедура")[:255]
                        proc_desc = item.get("description") or ""

                        cur.execute(
                            """
                            INSERT INTO schedule (user_id, protocol_id, procedure, description, time_to_do, proc_status)
                            VALUES (%s, %s, %s, %s, %s, 'waiting')
                            """,
                            (user_id, protocol_id, proc_title, proc_desc, time_to_do),
                        )

            return {
                "protocol_id": protocol_id,
                "schedule": get_user_schedule(user_id),
                "protocols": get_user_protocols(user_id),
            }
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        with conn:
            cur = conn.execute(
                """
                INSERT INTO protocols (user_id, raw_text, protocol, uploaded_at)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, raw_text, protocol_str, now_iso),
            )
            protocol_id = cur.lastrowid

            for item in reminders:
                date_part = item.get("date", "2026-01-01")
                time_part = item.get("time", "09:00")
                time_to_do = f"{date_part}T{time_part}:00+00:00"
                proc_title = (item.get("title") or item.get("procedure") or "Процедура")[:255]
                proc_desc = item.get("description") or ""

                conn.execute(
                    """
                    INSERT INTO schedule (user_id, protocol_id, procedure, description, time_to_do, proc_status)
                    VALUES (?, ?, ?, ?, ?, 'waiting')
                    """,
                    (user_id, protocol_id, proc_title, proc_desc, time_to_do),
                )

        return {
            "protocol_id": protocol_id,
            "schedule": get_user_schedule(user_id),
            "protocols": get_user_protocols(user_id),
        }
    finally:
        conn.close()


def _format_schedule_row(row: Dict[str, Any]) -> Dict[str, Any]:
    raw_ts = str(row.get("time_to_do") or "")
    # Извлекаем YYYY-MM-DD и HH:MM из ISO/timestamp строки
    date_str = raw_ts[:10] if len(raw_ts) >= 10 else "2026-01-01"
    time_str = "09:00"
    if "T" in raw_ts and len(raw_ts.split("T")[1]) >= 5:
        time_str = raw_ts.split("T")[1][:5]
    elif " " in raw_ts and len(raw_ts.split(" ")[1]) >= 5:
        time_str = raw_ts.split(" ")[1][:5]

    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "protocol_id": row.get("protocol_id"),
        "procedure": row["procedure"],
        "title": row["procedure"],
        "description": row.get("description") or "",
        "time_to_do": raw_ts,
        "date": date_str,
        "time": time_str,
        "proc_status": row.get("proc_status") or "waiting",
    }


def get_user_schedule(user_id: int) -> List[Dict[str, Any]]:
    """Загружает все записи расписания пользователя из таблицы schedule."""
    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, user_id, protocol_id, procedure, description, time_to_do, proc_status
                    FROM schedule
                    WHERE user_id = %s
                    ORDER BY time_to_do ASC, id ASC
                    """,
                    (user_id,),
                )
                return [_format_schedule_row(dict(r)) for r in cur.fetchall()]
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, user_id, protocol_id, procedure, description, time_to_do, proc_status
            FROM schedule
            WHERE user_id = ?
            ORDER BY time_to_do ASC, id ASC
            """,
            (user_id,),
        )
        return [_format_schedule_row(dict(r)) for r in cur.fetchall()]
    finally:
        conn.close()


def get_user_protocols(user_id: int) -> List[Dict[str, Any]]:
    """Загружает сохранённые JSON-протоколы пользователя из таблицы protocols."""
    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, user_id, raw_text, protocol, uploaded_at
                    FROM protocols
                    WHERE user_id = %s
                    ORDER BY uploaded_at DESC, id DESC
                    """,
                    (user_id,),
                )
                result = []
                for r in cur.fetchall():
                    d = dict(r)
                    d["uploaded_at"] = str(d["uploaded_at"])
                    if isinstance(d["protocol"], str):
                        try:
                            d["protocol"] = json.loads(d["protocol"])
                        except Exception:
                            pass
                    result.append(d)
                return result
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        cur = conn.execute(
            """
            SELECT id, user_id, raw_text, protocol, uploaded_at
            FROM protocols
            WHERE user_id = ?
            ORDER BY uploaded_at DESC, id DESC
            """,
            (user_id,),
        )
        result = []
        for r in cur.fetchall():
            d = dict(r)
            if isinstance(d["protocol"], str):
                try:
                    d["protocol"] = json.loads(d["protocol"])
                except Exception:
                    pass
            result.append(d)
        return result
    finally:
        conn.close()


def update_schedule_status(schedule_id: int, user_id: int, new_status: str) -> None:
    """Обновляет статус процедуры в расписании ('waiting', 'skipped', 'performed')."""
    if new_status not in VALID_STATUSES:
        raise ValueError(f"Недопустимый статус: {new_status}")

    pg_conn = get_pg_connection()
    if pg_conn is not None:
        try:
            with pg_conn:
                with pg_conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE schedule
                        SET proc_status = %s
                        WHERE id = %s AND user_id = %s
                        """,
                        (new_status, schedule_id, user_id),
                    )
            return
        finally:
            pg_conn.close()

    conn = get_sqlite_connection()
    try:
        with conn:
            conn.execute(
                """
                UPDATE schedule
                SET proc_status = ?
                WHERE id = ? AND user_id = ?
                """,
                (new_status, schedule_id, user_id),
            )
    finally:
        conn.close()
