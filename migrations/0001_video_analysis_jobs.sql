-- Durable state for live walkthrough video processing.
-- Run with the service migration identity before enabling APP_ANALYSIS_MODE=live.
CREATE TABLE IF NOT EXISTS video_analysis_jobs (
  id uuid PRIMARY KEY,
  session_id varchar(128) NOT NULL,
  room_id varchar(32) NOT NULL,
  schema_version integer NOT NULL,
  video_id varchar(128) NOT NULL,
  video_revision integer NOT NULL,
  analysis_id varchar(128) NOT NULL,
  attempt integer NOT NULL,
  catalog_version varchar(128) NOT NULL,
  expected_video_sha256 char(64),
  normalized_video_sha256 char(64),
  media_object_key text NOT NULL,
  media_content_type varchar(40) NOT NULL CHECK (media_content_type IN ('video/mp4','video/quicktime')),
  media_duration_ms integer CHECK (media_duration_ms > 0 AND media_duration_ms <= 30000),
  media_width integer CHECK (media_width > 0 AND media_width <= 16384),
  media_height integer CHECK (media_height > 0 AND media_height <= 16384),
  media_content_length integer NOT NULL CHECK (media_content_length > 0 AND media_content_length <= 62914560),
  status varchar(32) NOT NULL CHECK (status IN (
    'upload_pending', 'ready', 'queued', 'segmenting', 'mapping', 'completed',
    'failed', 'ambiguous', 'cancel_requested', 'cancelled'
  )),
  stage varchar(32) NOT NULL CHECK (stage IN ('upload', 'ready', 'queued', 'sam', 'muse', 'complete')),
  retryable boolean NOT NULL DEFAULT false,
  safe_error_code varchar(64),
  safe_error_message varchar(240),
  sam_started_at timestamptz,
  sam_completed_at timestamptz,
  muse_started_at timestamptz,
  completed_at timestamptz,
  candidate_token text,
  segment_result jsonb,
  still_objects jsonb,
  result jsonb,
  cancel_requested_at timestamptz,
  worker_lease_id uuid,
  worker_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (
    (status = 'upload_pending' AND expected_video_sha256 IS NULL) OR
    status = 'cancelled' OR
    (status <> 'upload_pending' AND expected_video_sha256 ~ '^[a-f0-9]{64}$')
  ),
  UNIQUE (session_id, analysis_id, attempt)
);

CREATE INDEX IF NOT EXISTS video_analysis_jobs_session_idx
  ON video_analysis_jobs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_analysis_jobs_expiry_idx
  ON video_analysis_jobs (expires_at)
  WHERE status IN ('upload_pending', 'ready', 'queued', 'segmenting', 'mapping', 'completed', 'failed', 'ambiguous', 'cancelled');
CREATE INDEX IF NOT EXISTS video_analysis_jobs_stale_lease_idx
  ON video_analysis_jobs (worker_lease_expires_at)
  WHERE status IN ('segmenting', 'mapping');

-- R2 evidence objects are private, write-once, and referenced only by job rows.
-- These rows make retention cleanup independent from the pg-boss queue tables.
CREATE TABLE IF NOT EXISTS video_analysis_job_objects (
  job_id uuid NOT NULL REFERENCES video_analysis_jobs(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  object_kind varchar(16) NOT NULL CHECK (object_kind IN ('media', 'candidate', 'context', 'evidence')),
  still_id varchar(180),
  sha256 char(64),
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 62914560),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (job_id, object_key),
  UNIQUE (job_id, still_id)
);

CREATE INDEX IF NOT EXISTS video_analysis_job_objects_live_idx
  ON video_analysis_job_objects (job_id, object_kind)
  WHERE deleted_at IS NULL;

