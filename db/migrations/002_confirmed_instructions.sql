-- The initial schema stores event-level descriptions but has no place for the
-- complete patient-confirmed instructions, including non-calendar instructions.
-- This stores confirmed instructions only, never a raw OCR draft.
BEGIN;
SELECT pg_advisory_xact_lock(20261005, 1);
DO $migration$
BEGIN
    IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '002_confirmed_instructions') THEN
        RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '001_initial_schema') THEN
        RAISE EXCEPTION '001_initial_schema must already be applied';
    END IF;
    ALTER TABLE public.plans ADD COLUMN confirmed_instructions text;
    COMMENT ON COLUMN public.plans.confirmed_instructions IS
        'Complete patient-confirmed instructions. Never store unconfirmed OCR text.';
    INSERT INTO public.schema_migrations(version) VALUES ('002_confirmed_instructions');
END;
$migration$;
COMMIT;
