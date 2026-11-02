CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_members (
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (family_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_members_family ON family_members(family_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS family_invitations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_invitations_family ON family_invitations(family_id);

-- revision + sync_nonce provide optimistic concurrency control for shared family data.
CREATE TABLE IF NOT EXISTS family_state (
  family_id TEXT PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  sync_nonce TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- Pets and their related records are stored as JSON snapshots plus indexed columns.
-- This preserves the prototype's flexible fields while keeping the data queryable in D1.
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  breed TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT 'blue',
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pets_family ON pets(family_id);

CREATE TABLE IF NOT EXISTS health_records (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_records_family_date ON health_records(family_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_health_records_pet_date ON health_records(pet_id, date DESC);

CREATE TABLE IF NOT EXISTS care_tasks (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_care_tasks_family_date ON care_tasks(family_id, date ASC);
CREATE INDEX IF NOT EXISTS idx_care_tasks_pet_date ON care_tasks(pet_id, date ASC);

CREATE TABLE IF NOT EXISTS pet_profile_changes (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pet_profile_changes_pet ON pet_profile_changes(pet_id, created_at DESC);

-- Notification preferences are per account, not shared by the family.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
