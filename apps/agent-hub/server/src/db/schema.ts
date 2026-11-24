// server/src/db/schema.ts
export const MIGRATION_1 = `
CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes       TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
  is_default   INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
) STRICT;

CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  short_id            TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  adapter_kind        TEXT NOT NULL,
  repo_id             TEXT NOT NULL,
  repo_path           TEXT NOT NULL,
  source              TEXT NOT NULL,
  source_token_id     TEXT REFERENCES api_tokens (id),
  external_ref        TEXT,
  mode                TEXT NOT NULL,
  workspace_kind      TEXT NOT NULL,
  workspace_path      TEXT,
  branch              TEXT,
  base_ref            TEXT,
  base_commit         TEXT,
  base_tree           TEXT,
  model               TEXT,
  reasoning_effort    TEXT,
  user_visible        INTEGER NOT NULL CHECK (user_visible IN (0, 1)),
  native_session_id   TEXT,
  remote_url          TEXT,
  status              TEXT NOT NULL CHECK (status IN ('queued', 'preparing', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  pending_approvals   INTEGER NOT NULL DEFAULT 0 CHECK (pending_approvals >= 0),
  turn_count          INTEGER NOT NULL DEFAULT 0,
  last_event_seq      INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT CHECK (last_error IS NULL OR json_valid(last_error)),
  read_only_violation INTEGER NOT NULL DEFAULT 0 CHECK (read_only_violation IN (0, 1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  started_at          TEXT,
  ended_at            TEXT,
  archived_at         TEXT,
  worktree_removed_at TEXT
) STRICT;
CREATE INDEX tasks_by_created ON tasks (created_at DESC, id DESC);
CREATE INDEX tasks_by_status ON tasks (status);
CREATE INDEX tasks_by_external_ref ON tasks (external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE turns (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  idx              INTEGER NOT NULL CHECK (idx >= 1),
  prompt           TEXT NOT NULL,
  model            TEXT,
  reasoning_effort TEXT,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
  stop_reason      TEXT,
  error            TEXT CHECK (error IS NULL OR json_valid(error)),
  native_turn_id   TEXT,
  before_tree      TEXT,
  after_tree       TEXT,
  turn_patch       TEXT,
  task_patch       TEXT,
  turn_stats       TEXT CHECK (turn_stats IS NULL OR json_valid(turn_stats)),
  task_stats       TEXT CHECK (task_stats IS NULL OR json_valid(task_stats)),
  patch_truncated  INTEGER NOT NULL DEFAULT 0 CHECK (patch_truncated IN (0, 1)),
  usage            TEXT CHECK (usage IS NULL OR json_valid(usage)),
  final_message    TEXT,
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  ended_at         TEXT,
  UNIQUE (task_id, idx)
) STRICT;

CREATE TABLE events (
  task_id  TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  turn_id  TEXT,
  type     TEXT NOT NULL,
  is_delta INTEGER NOT NULL CHECK (is_delta IN (0, 1)),
  payload  TEXT NOT NULL CHECK (json_valid(payload)),
  ts       TEXT NOT NULL,
  PRIMARY KEY (task_id, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE approvals (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  turn_id             TEXT NOT NULL REFERENCES turns (id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  title               TEXT NOT NULL,
  request             TEXT NOT NULL CHECK (json_valid(request)),
  options             TEXT NOT NULL CHECK (json_valid(options) AND json_type(options) = 'array'),
  status              TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'withdrawn')),
  decision            TEXT,
  decided_by          TEXT,
  decided_by_token_id TEXT,
  note                TEXT,
  created_at          TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  resolved_at         TEXT
) STRICT;
CREATE INDEX approvals_by_status ON approvals (status, created_at);
CREATE INDEX approvals_by_task ON approvals (task_id, created_at);

CREATE TABLE idempotency_keys (
  token_id     TEXT NOT NULL REFERENCES api_tokens (id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  task_id      TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  turn_id      TEXT REFERENCES turns (id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (token_id, key)
) STRICT, WITHOUT ROWID;

CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  task_id TEXT,
  detail  TEXT CHECK (detail IS NULL OR json_valid(detail))
) STRICT;
CREATE INDEX audit_by_ts ON audit_log (ts);

CREATE TABLE processes (
  pid        INTEGER PRIMARY KEY,
  pgid       INTEGER NOT NULL,
  label      TEXT NOT NULL,
  command    TEXT NOT NULL,
  task_id    TEXT,
  started_at TEXT NOT NULL
) STRICT;
`;
