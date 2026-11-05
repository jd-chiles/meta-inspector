-- Durable cloud source of truth for human-reviewed walkthrough state.
-- Video objects remain referenced through video_analysis_jobs and
-- video_analysis_job_objects, both of which are scoped by session_id.
CREATE TABLE IF NOT EXISTS inspection_sessions (
  session_id varchar(128) PRIMARY KEY,
  schema_version integer NOT NULL,
  catalog_version varchar(128) NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  inspection jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS inspection_sessions_live_updated_idx
  ON inspection_sessions (updated_at DESC)
  WHERE deleted_at IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'video_analysis_jobs_session_fk'
  ) THEN
    ALTER TABLE video_analysis_jobs
      ADD CONSTRAINT video_analysis_jobs_session_fk
      FOREIGN KEY (session_id) REFERENCES inspection_sessions(session_id) ON DELETE CASCADE;
  END IF;
END $$;
