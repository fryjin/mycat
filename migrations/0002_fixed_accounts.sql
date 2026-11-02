-- Fixed two-account family mode for MyCat.
-- Authorization uses the MYCAT_LOGIN_KEY Worker Secret. Placeholder hashes are never used for login.

INSERT OR IGNORE INTO users (id, email, name, password_hash, password_salt, created_at)
VALUES
  ('mycat-user-paotai', 'paotai@mycat.local', '炮台', 'fixed-account-only', 'fixed-account-only', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('mycat-user-yutou', 'yutou@mycat.local', '芋头', 'fixed-account-only', 'fixed-account-only', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO families (id, name, owner_user_id, created_at, updated_at)
VALUES ('mycat-family-fixed', '我们的小家', 'mycat-user-paotai',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO family_members (family_id, user_id, role, joined_at)
VALUES
  ('mycat-family-fixed', 'mycat-user-paotai', 'owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('mycat-family-fixed', 'mycat-user-yutou', 'editor', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO family_state (family_id, revision, sync_nonce, updated_at)
VALUES ('mycat-family-fixed', 0, '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO user_preferences (user_id, settings_json, updated_at)
VALUES
  ('mycat-user-paotai', '{"push":true,"email":false,"internal":true,"dual":false,"quiet":true,"quietFrom":"22:00","quietTo":"08:00","mail":""}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('mycat-user-yutou', '{"push":true,"email":false,"internal":true,"dual":false,"quiet":true,"quietFrom":"22:00","quietTo":"08:00","mail":""}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO pets (id, family_id, name, breed, tone, data_json, created_at, updated_at)
VALUES
  ('mycat-pet-blue', 'mycat-family-fixed', '蓝猫', '英国短毛猫', 'blue',
   json_object('id','mycat-pet-blue','name','蓝猫','breed','英国短毛猫','sex','','birthday','','neutered','','chip','','allergy','','notes','','tone','blue','photo','','createdAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('mycat-pet-silver', 'mycat-family-fixed', '银点', '银点', 'silver',
   json_object('id','mycat-pet-silver','name','银点','breed','银点','sex','','birthday','','neutered','','chip','','allergy','','notes','','tone','silver','photo','','createdAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('mycat-pet-tux', 'mycat-family-fixed', '奶牛猫', '中华田园猫', 'tux',
   json_object('id','mycat-pet-tux','name','奶牛猫','breed','中华田园猫','sex','','birthday','','neutered','','chip','','allergy','','notes','','tone','tux','photo','','createdAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Revoke legacy email/password sessions after switching to fixed-account mode. Existing legacy data is not deleted.
DELETE FROM sessions;
