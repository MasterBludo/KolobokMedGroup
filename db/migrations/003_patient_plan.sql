-- One plan per patient. Refuse ambiguous ownership; never merge existing data.
BEGIN;
SELECT pg_advisory_xact_lock(20261005, 1);
DO $migration$
DECLARE conflicts text;
BEGIN
    IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='003_patient_plan') THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='002_confirmed_instructions') THEN
        RAISE EXCEPTION '002_confirmed_instructions must already be applied';
    END IF;
    -- Prevent writes between preflight and relationship migration.
    LOCK TABLE public.patients, public.recovery_cases, public.plans, public.upload_records IN ACCESS EXCLUSIVE MODE;
    SELECT string_agg(patient_id::text, ', ') INTO conflicts
        FROM (SELECT patient_id FROM public.recovery_cases GROUP BY patient_id HAVING count(*)>1) c;
    IF conflicts IS NOT NULL THEN
        RAISE EXCEPTION 'Migration conflict: multiple recovery cases for patients: %. Resolve explicitly before migration.', conflicts;
    END IF;
    SELECT string_agg(patient_id::text, ', ') INTO conflicts
        FROM (SELECT c.patient_id FROM public.plans p JOIN public.recovery_cases c ON c.id=p.recovery_case_id
              GROUP BY c.patient_id HAVING count(*)>1) p;
    IF conflicts IS NOT NULL THEN
        RAISE EXCEPTION 'Migration conflict: multiple plans for patients: %.', conflicts;
    END IF;
    SELECT string_agg(patient_id::text, ', ') INTO conflicts
        FROM (SELECT c.patient_id FROM public.upload_records u JOIN public.recovery_cases c ON c.id=u.recovery_case_id
              GROUP BY c.patient_id,u.file_sha256 HAVING count(*)>1) u;
    IF conflicts IS NOT NULL THEN
        RAISE EXCEPTION 'Migration conflict: duplicate uploads for patients: %.', conflicts;
    END IF;

    ALTER TABLE public.plans ADD COLUMN patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE;
    ALTER TABLE public.plans ADD COLUMN recovery_start_date date;
    -- Retain existing procedure/date/status metadata, including cases without a plan.
    ALTER TABLE public.plans ADD COLUMN procedure_name text;
    ALTER TABLE public.plans ADD COLUMN surgery_date date;
    ALTER TABLE public.plans ADD COLUMN recovery_status text;
    ALTER TABLE public.plans DISABLE TRIGGER plans_touch_updated_at;
    UPDATE public.plans p SET patient_id=c.patient_id,recovery_start_date=c.recovery_start_date,
        procedure_name=c.procedure_name,surgery_date=c.surgery_date,recovery_status=c.status
        FROM public.recovery_cases c WHERE c.id=p.recovery_case_id;
    INSERT INTO public.plans(recovery_case_id,patient_id,recovery_start_date,procedure_name,surgery_date,recovery_status,created_at,updated_at)
        SELECT c.id,c.patient_id,c.recovery_start_date,c.procedure_name,c.surgery_date,c.status,c.created_at,c.updated_at
        FROM public.recovery_cases c WHERE NOT EXISTS (SELECT 1 FROM public.plans p WHERE p.recovery_case_id=c.id);
    ALTER TABLE public.plans ENABLE TRIGGER plans_touch_updated_at;
    ALTER TABLE public.plans ALTER COLUMN patient_id SET NOT NULL;
    ALTER TABLE public.plans ADD CONSTRAINT plans_patient_unique UNIQUE(patient_id);
    COMMENT ON COLUMN public.plans.recovery_start_date IS 'Confirmed start date; NULL means unknown. Never infer from upload date.';

    ALTER TABLE public.upload_records ADD COLUMN patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE;
    ALTER TABLE public.upload_records DISABLE TRIGGER upload_records_touch_updated_at;
    UPDATE public.upload_records u SET patient_id=c.patient_id FROM public.recovery_cases c WHERE c.id=u.recovery_case_id;
    ALTER TABLE public.upload_records ENABLE TRIGGER upload_records_touch_updated_at;
    ALTER TABLE public.upload_records ALTER COLUMN patient_id SET NOT NULL;
    ALTER TABLE public.upload_records ADD CONSTRAINT upload_records_file_patient_unique UNIQUE(patient_id,file_sha256);

    -- New ownership FKs and uniqueness are valid before removing old relationships.
    ALTER TABLE public.plans DROP COLUMN recovery_case_id;
    ALTER TABLE public.upload_records DROP COLUMN recovery_case_id;
    DROP TABLE public.recovery_cases;
    INSERT INTO public.schema_migrations(version) VALUES('003_patient_plan');
END;
$migration$;
COMMIT;
