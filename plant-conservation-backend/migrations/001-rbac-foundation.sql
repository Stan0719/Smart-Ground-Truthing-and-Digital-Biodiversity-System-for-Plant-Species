DO $$ BEGIN
 IF to_regclass('public.species') IS NULL OR to_regclass('public.plant_record') IS NULL OR to_regclass('public.plant_location') IS NULL THEN RAISE EXCEPTION 'Inspect and restore existing plant schema before migration'; END IF;
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='plant_record' AND column_name='registered_by' AND udt_name IN ('int2','int4','int8')) THEN RAISE EXCEPTION 'Unrecognized legacy ownership column'; END IF;
END $$;
ALTER TABLE public.plant_record ADD COLUMN registered_subject TEXT CHECK(registered_subject IS NULL OR registered_subject LIKE 'staff:%');
ALTER TABLE public.plant_record ALTER COLUMN registered_by DROP NOT NULL;
ALTER TABLE public.plant_record ADD COLUMN rbac_status TEXT NOT NULL DEFAULT 'Pending Review' CHECK(rbac_status IN ('Pending Review','Approved','Rejected'));
ALTER TABLE public.plant_record ADD COLUMN qr_token TEXT UNIQUE;
ALTER TABLE public.species ADD COLUMN rbac_data JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE public.rbac_species_visibility(species_id BIGINT PRIMARY KEY REFERENCES public.species(species_id) ON DELETE CASCADE,visibility TEXT NOT NULL CHECK(visibility IN ('public','internal','protected')));
CREATE INDEX plant_subject_idx ON public.plant_record(registered_subject);
