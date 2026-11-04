DO $$ BEGIN
 IF to_regclass('public.observation') IS NOT NULL OR to_regclass('public.observations') IS NOT NULL OR to_regclass('public.sensor') IS NOT NULL OR to_regclass('public.sensors') IS NOT NULL OR to_regclass('public.threat_alert') IS NOT NULL THEN RAISE EXCEPTION 'Equivalent domain tables may exist. Adapt migration to existing schema; do not duplicate them.'; END IF;
END $$;
CREATE TABLE public.plant_observation(
 id TEXT PRIMARY KEY,plant_id BIGINT NOT NULL REFERENCES public.plant_record(plant_id),owner_subject TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('Draft','Pending Review','Approved','Rejected','Flagged','Correction Required')),
 content JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),client_key TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(owner_subject,client_key)
);
CREATE TABLE public.observation_review(id TEXT PRIMARY KEY,observation_id TEXT NOT NULL REFERENCES public.plant_observation(id),reviewer_subject TEXT NOT NULL,decision TEXT NOT NULL,comment TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public.plant_asset(id TEXT PRIMARY KEY,species_id BIGINT REFERENCES public.species(species_id),plant_id BIGINT REFERENCES public.plant_record(plant_id),owner_subject TEXT NOT NULL,client_key TEXT NOT NULL,observation_id TEXT REFERENCES public.plant_observation(id),approved BOOLEAN NOT NULL DEFAULT false,content_type TEXT NOT NULL,content BYTEA NOT NULL CHECK(octet_length(content)<=4194304),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(owner_subject,client_key),CHECK((species_id IS NULL)!=(plant_id IS NULL)));
CREATE TABLE public.iot_device(id TEXT PRIMARY KEY,name TEXT NOT NULL,plant_id BIGINT REFERENCES public.plant_record(plant_id),key_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),thresholds JSONB NOT NULL DEFAULT '{}'::jsonb,last_seen TIMESTAMPTZ);
CREATE TABLE public.sensor_reading(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES public.iot_device(id),"values" JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public.threat_alert_history(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES public.iot_device(id),reading_id TEXT NOT NULL REFERENCES public.sensor_reading(id),metric TEXT NOT NULL,value DOUBLE PRECISION NOT NULL,status TEXT NOT NULL DEFAULT 'New' CHECK(status IN ('New','Reviewing','Resolved')),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public.threat_response(id TEXT PRIMARY KEY,alert_id TEXT NOT NULL REFERENCES public.threat_alert_history(id),officer_subject TEXT NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Reviewing','Resolved')),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public.business_audit(id TEXT PRIMARY KEY,actor_subject TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX observation_owner_idx ON public.plant_observation(owner_subject);
CREATE INDEX reading_device_time_idx ON public.sensor_reading(device_id,created_at DESC);
