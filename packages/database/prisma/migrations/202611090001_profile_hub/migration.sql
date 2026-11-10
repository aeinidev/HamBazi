BEGIN;
ALTER TABLE users ADD COLUMN username TEXT,
  ADD COLUMN profile_avatar TEXT;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (
  username IS NULL OR (username ~ '^[a-z0-9_]{3,32}$')
);
CREATE UNIQUE INDEX users_username_key ON users(username);
ALTER TABLE users ADD CONSTRAINT users_profile_avatar_length CHECK (
  profile_avatar IS NULL OR length(profile_avatar) <= 240000
);
COMMIT;
