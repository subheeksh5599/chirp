-- Chirp schema. `$S.` is replaced with the target schema by the migration runner.
CREATE TABLE IF NOT EXISTS $S.devices (
  id uuid PRIMARY KEY,
  secret_hash text NOT NULL,
  pair_code text UNIQUE,
  tg_user_id bigint,
  tg_name text,
  tg_username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paired_at timestamptz
);

CREATE TABLE IF NOT EXISTS $S.sessions (
  id text PRIMARY KEY,
  title text NOT NULL,
  admin_hash text NOT NULL,
  key_hex text NOT NULL,
  slides jsonb NOT NULL,
  deck_url text,
  channel_url text,
  current_slide int NOT NULL DEFAULT 0,
  rule_min_codes int NOT NULL DEFAULT 3,
  rule_min_minutes int NOT NULL DEFAULT 10,
  caption text,
  caption_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS $S.hearings (
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES $S.sessions(id) ON DELETE CASCADE,
  slot bigint NOT NULL,
  heard_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, session_id, slot)
);

CREATE TABLE IF NOT EXISTS $S.votes (
  session_id text NOT NULL REFERENCES $S.sessions(id) ON DELETE CASCADE,
  slide int NOT NULL,
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  choice int NOT NULL CHECK (choice IN (0, 1)),
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, slide, device_id)
);

CREATE TABLE IF NOT EXISTS $S.presence (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES $S.sessions(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  record jsonb NOT NULL,
  signature text NOT NULL,
  anchor_tx text,
  anchored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, device_id)
);

CREATE TABLE IF NOT EXISTS $S.handoffs (
  token text PRIMARY KEY,
  kind text NOT NULL,
  owner_tg_id bigint,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS $S.payments (
  id text PRIMARY KEY,
  token text NOT NULL REFERENCES $S.handoffs(token) ON DELETE CASCADE,
  device_id uuid REFERENCES $S.devices(id) ON DELETE SET NULL,
  shop text NOT NULL,
  amount_nano bigint NOT NULL,
  comment text NOT NULL UNIQUE,
  tx_hash text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS $S.markers (
  token text PRIMARY KEY,
  market_id text NOT NULL,
  question text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS $S.heard_log (
  id bigserial PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref text NOT NULL,
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  heard_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, kind, ref)
);

CREATE TABLE IF NOT EXISTS $S.contacts (
  id bigserial PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  other_tg_id bigint NOT NULL,
  other_name text NOT NULL,
  other_username text,
  role text,
  met_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, other_tg_id)
);

CREATE TABLE IF NOT EXISTS $S.paper (
  id bigserial PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  market_id text NOT NULL,
  question text NOT NULL,
  side text NOT NULL CHECK (side IN ('YES', 'NO')),
  entry_price numeric NOT NULL,
  stake numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS heard_log_device_time ON $S.heard_log (device_id, heard_at DESC);
CREATE INDEX IF NOT EXISTS sessions_active ON $S.sessions (created_at) WHERE ended_at IS NULL;

-- v2: shared links / notes as a hand-off kind
ALTER TABLE $S.handoffs DROP CONSTRAINT IF EXISTS handoffs_kind_check;
ALTER TABLE $S.handoffs ADD CONSTRAINT handoffs_kind_check CHECK (kind IN ('connect', 'pay', 'link'));

-- v3: every resolve the glasses ask for, so spam is rate-limited and rejected codes (replays, forgeries) are logged
CREATE TABLE IF NOT EXISTS $S.resolves (
  device_id uuid NOT NULL REFERENCES $S.devices(id) ON DELETE CASCADE,
  frame text NOT NULL,
  outcome text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resolves_device_at ON $S.resolves (device_id, at);
