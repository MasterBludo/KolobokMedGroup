-- Recovery: initial schema. PostgreSQL 14+; no extensions required.
-- Run as recovery_app, the owner of recovery_dev, using psql -v ON_ERROR_STOP=1.
-- Creates empty tables only. Never inserts real patients or credentials.
-- Keep this migration unchanged after applying it; use 002_* for later changes.

BEGIN;
SELECT pg_advisory_xact_lock(20261005, 1);

CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.schema_migrations WHERE version = '001_initial_schema'
    ) THEN
        RAISE NOTICE '001_initial_schema already applied; no changes made.';
        RETURN;
    END IF;

    CREATE TABLE public.patients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username text NOT NULL,
        email text UNIQUE,
        phone text UNIQUE,
        password_hash text NOT NULL,
        timezone text NOT NULL DEFAULT 'Europe/Moscow',
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT patients_username_valid CHECK (
            username = btrim(username) AND char_length(username) BETWEEN 1 AND 100
        ),
        CONSTRAINT patients_contact_required CHECK (email IS NOT NULL OR phone IS NOT NULL),
        CONSTRAINT patients_email_normalized CHECK (
            email IS NULL OR (
                email = lower(btrim(email)) AND char_length(email) <= 254
                AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
            )
        ),
        CONSTRAINT patients_phone_normalized CHECK (
            phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'
        ),
        CONSTRAINT patients_password_hash_not_empty CHECK (
            char_length(btrim(password_hash)) BETWEEN 1 AND 1024
        ),
        CONSTRAINT patients_timezone_not_empty CHECK (char_length(btrim(timezone)) > 0)
    );

    CREATE TABLE public.recovery_cases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
        procedure_name text,
        surgery_date date,
        recovery_start_date date,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT recovery_cases_status_valid CHECK (status IN ('active', 'completed', 'archived')),
        CONSTRAINT recovery_cases_procedure_not_empty CHECK (
            procedure_name IS NULL OR char_length(btrim(procedure_name)) > 0
        )
    );
    CREATE INDEX recovery_cases_patient_idx ON public.recovery_cases(patient_id, created_at);

    CREATE TABLE public.plans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recovery_case_id uuid NOT NULL UNIQUE
            REFERENCES public.recovery_cases(id) ON DELETE CASCADE,
        version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'archived')),
        generated_by_model text,
        confirmed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT plans_confirmation_valid CHECK (
            (status = 'draft' AND confirmed_at IS NULL)
            OR (status = 'confirmed' AND confirmed_at IS NOT NULL)
            OR status = 'archived'
        )
    );

    CREATE TABLE public.prescriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
        kind text NOT NULL DEFAULT 'other' CHECK (
            kind IN ('medication', 'wound_care', 'appointment', 'activity', 'other')
        ),
        title text NOT NULL CHECK (char_length(btrim(title)) > 0),
        instruction text NOT NULL CHECK (char_length(btrim(instruction)) > 0),
        medication_name text,
        dose_text text,
        frequency_text text,
        starts_on date,
        ends_on date,
        duration_days integer CHECK (duration_days > 0),
        interval_days integer CHECK (interval_days > 0),
        times_of_day time(0)[],
        as_needed boolean NOT NULL DEFAULT false,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'cancelled')),
        dedup_key text NOT NULL CHECK (dedup_key ~ '^[0-9a-f]{64}$'),
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT prescriptions_date_range_valid CHECK (
            starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on
        ),
        CONSTRAINT prescriptions_times_valid CHECK (
            times_of_day IS NULL OR (
                cardinality(times_of_day) > 0
                AND array_ndims(times_of_day) = 1
                AND array_position(times_of_day, NULL::time) IS NULL
            )
        ),
        CONSTRAINT prescriptions_id_plan_unique UNIQUE (id, plan_id)
    );
    -- Backend computes the SHA-256 key from a versioned, normalized representation
    -- of the entire confirmed prescription, including dates/dose/frequency.
    -- Semantic matching and conflicts require backend logic and confirmation.
    CREATE UNIQUE INDEX prescriptions_active_dedup_idx
        ON public.prescriptions(plan_id, dedup_key) WHERE status = 'active';
    CREATE INDEX prescriptions_plan_idx ON public.prescriptions(plan_id);

    CREATE TABLE public.plan_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
        prescription_id uuid NOT NULL,
        scheduled_date date NOT NULL,
        scheduled_time time(0),
        occurrence_index smallint NOT NULL DEFAULT 1 CHECK (occurrence_index > 0),
        status text NOT NULL DEFAULT 'pending' CHECK (
            status IN ('pending', 'completed', 'skipped', 'cancelled')
        ),
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT plan_events_prescription_plan_fk FOREIGN KEY (prescription_id, plan_id)
            REFERENCES public.prescriptions(id, plan_id) ON DELETE CASCADE,
        CONSTRAINT plan_events_occurrence_unique UNIQUE (
            prescription_id, scheduled_date, occurrence_index
        ),
        CONSTRAINT plan_events_completion_valid CHECK (
            (status = 'completed' AND completed_at IS NOT NULL)
            OR (status <> 'completed' AND completed_at IS NULL)
        )
    );
    -- occurrence_index distinguishes multiple tasks on a day with unspecified times.
    CREATE UNIQUE INDEX plan_events_known_time_unique_idx
        ON public.plan_events(prescription_id, scheduled_date, scheduled_time)
        WHERE scheduled_time IS NOT NULL;
    CREATE INDEX plan_events_calendar_idx ON public.plan_events(plan_id, scheduled_date, scheduled_time);

    CREATE TABLE public.upload_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recovery_case_id uuid NOT NULL REFERENCES public.recovery_cases(id) ON DELETE CASCADE,
        file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
        status text NOT NULL DEFAULT 'processing' CHECK (
            status IN ('processing', 'completed', 'failed')
        ),
        attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
        error_code text,
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT upload_records_file_case_unique UNIQUE (recovery_case_id, file_sha256),
        CONSTRAINT upload_records_processing_valid CHECK (
            (status = 'processing' AND processed_at IS NULL)
            OR (status IN ('completed', 'failed') AND processed_at IS NOT NULL)
        )
    );

    CREATE TABLE public.sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        CONSTRAINT sessions_expiry_valid CHECK (expires_at > created_at),
        CONSTRAINT sessions_revocation_valid CHECK (revoked_at IS NULL OR revoked_at >= created_at)
    );
    CREATE INDEX sessions_patient_idx ON public.sessions(patient_id);
    CREATE INDEX sessions_expiry_idx ON public.sessions(expires_at);

    CREATE FUNCTION public.recovery_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql AS $function$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER patients_touch_updated_at BEFORE UPDATE ON public.patients
        FOR EACH ROW EXECUTE FUNCTION public.recovery_touch_updated_at();
    CREATE TRIGGER recovery_cases_touch_updated_at BEFORE UPDATE ON public.recovery_cases
        FOR EACH ROW EXECUTE FUNCTION public.recovery_touch_updated_at();
    CREATE TRIGGER plans_touch_updated_at BEFORE UPDATE ON public.plans
        FOR EACH ROW EXECUTE FUNCTION public.recovery_touch_updated_at();
    CREATE TRIGGER prescriptions_touch_updated_at BEFORE UPDATE ON public.prescriptions
        FOR EACH ROW EXECUTE FUNCTION public.recovery_touch_updated_at();
    CREATE TRIGGER plan_events_touch_updated_at BEFORE UPDATE ON public.plan_events
        FOR EACH ROW EXECUTE FUNCTION public.recovery_touch_updated_at();
    CREATE TRIGGER upload_records_touch_updated_at BEFORE UPDATE ON public.upload_records
        FOR EACH ROW EXECUTE FUNCTION public.recovery_touch_updated_at();

    COMMENT ON COLUMN public.patients.password_hash IS
        'Backend-generated password hash (e.g. Argon2id). Never store a plaintext password.';
    COMMENT ON COLUMN public.patients.timezone IS
        'IANA timezone; backend must validate against supported timezone names.';
    COMMENT ON COLUMN public.recovery_cases.recovery_start_date IS
        'Confirmed start date. NULL means unknown; never infer from upload date automatically.';
    COMMENT ON COLUMN public.plans.version IS
        'Current plan revision counter, incremented by backend. This is not a historical snapshot.';
    COMMENT ON COLUMN public.prescriptions.dedup_key IS
        'Backend-generated canonical SHA-256 fingerprint; does not establish semantic equivalence.';
    COMMENT ON COLUMN public.prescriptions.times_of_day IS
        'Confirmed local times only. NULL means unspecified; no default medical times.';
    COMMENT ON COLUMN public.plan_events.scheduled_time IS
        'Local time in patients.timezone. NULL means unspecified.';
    COMMENT ON COLUMN public.plan_events.occurrence_index IS
        'Stable occurrence number per prescription/day; backend must reuse it on retries.';
    COMMENT ON TABLE public.upload_records IS
        'Processing metadata only: no document bytes, file paths, OCR text, or filenames.';
    COMMENT ON COLUMN public.upload_records.status IS
        'completed only after confirmed prescriptions/events have been committed; failed uploads can be retried.';
    COMMENT ON COLUMN public.sessions.token_hash IS
        'SHA-256 of a cryptographically random session token. Never store the raw token.';

    INSERT INTO public.schema_migrations(version) VALUES ('001_initial_schema');
    RAISE NOTICE '001_initial_schema applied successfully.';
END;
$migration$;

COMMIT;
