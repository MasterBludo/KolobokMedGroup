-- Тип статуса выполнения процедуры в расписании
DO $$ BEGIN
    CREATE TYPE status AS ENUM ('waiting', 'skipped', 'performed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Таблица пользователей (пациентов)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) NOT NULL UNIQUE,
    login VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- Таблица загруженных медицинских протоколов (выписок) в формате JSON
CREATE TABLE IF NOT EXISTS protocols (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    raw_text TEXT NOT NULL DEFAULT '',
    protocol JSONB NOT NULL DEFAULT '{}',
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_protocols_users_id
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

-- Таблица календарного расписания процедур и приёма лекарств
-- (исправлена опечатка shcedule -> schedule и TIMESTAMP WITH TIME ZONE)
CREATE TABLE IF NOT EXISTS schedule (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    protocol_id INTEGER,
    procedure VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    time_to_do TIMESTAMP WITH TIME ZONE NOT NULL,
    proc_status status NOT NULL DEFAULT 'waiting',

    CONSTRAINT fk_schedule_users_id
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,

    CONSTRAINT fk_schedule_protocol_id
        FOREIGN KEY (protocol_id)
        REFERENCES protocols(id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_protocols_user_id ON protocols(user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_user_time ON schedule(user_id, time_to_do);
