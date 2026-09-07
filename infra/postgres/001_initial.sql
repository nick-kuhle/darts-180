-- Darts 180 Phase-2 event store. Apply only through migrations in production.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE games (
  game_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('x01', 'cricket', 'count-up', 'around-the-clock')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE game_players (
  game_id UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  position SMALLINT NOT NULL CHECK (position >= 0),
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, position)
);

-- Event JSON remains immutable. Projections may be discarded and rebuilt from this stream.
CREATE TABLE game_events (
  game_id UUID NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_id UUID NOT NULL UNIQUE,
  idempotency_key UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_subject TEXT,
  event JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, sequence),
  UNIQUE (game_id, idempotency_key)
);
CREATE INDEX game_events_game_accepted_idx ON game_events (game_id, accepted_at DESC);
CREATE INDEX game_events_type_idx ON game_events (event_type);

CREATE TABLE game_snapshots (
  game_id UUID PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL DEFAULT 0,
  state JSONB NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  projector_version TEXT NOT NULL
);

-- Calibration metadata contains no raw images. Pixel-level media belongs in object storage only.
CREATE TABLE device_calibrations (
  calibration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_installation_id UUID NOT NULL,
  board_profile TEXT NOT NULL,
  quality JSONB NOT NULL,
  homography JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ
);

-- Strictly opt-in, de-identified labels. Object keys have retention/deletion lifecycle rules.
CREATE TABLE vision_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consented_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT NOT NULL,
  device_installation_id UUID NOT NULL,
  model_version TEXT NOT NULL,
  predicted_zone JSONB NOT NULL,
  corrected_zone JSONB,
  quality JSONB NOT NULL,
  clip_object_key TEXT,
  delete_requested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vision_feedback_model_idx ON vision_feedback (model_version);
CREATE INDEX vision_feedback_delete_idx ON vision_feedback (delete_requested_at) WHERE delete_requested_at IS NOT NULL;
