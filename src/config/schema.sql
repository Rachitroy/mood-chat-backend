-- Run this once against your Postgres database to set up tables.
-- psql "$DATABASE_URL" -f src/config/schema.sql

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(32) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(64) NOT NULL,
    is_group      BOOLEAN NOT NULL DEFAULT FALSE,
    direct_with   INTEGER,  -- for 1-on-1 rooms, references the other user's id
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
    room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id            SERIAL PRIMARY KEY,
    room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    emotion_tag   VARCHAR(16) NOT NULL DEFAULT 'neutral',
    message_type  VARCHAR(10) NOT NULL DEFAULT 'text',
    file_url      TEXT,
    file_name     TEXT,
    file_mime     TEXT,
    file_size     INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reply-to-a-specific-message support. ON DELETE SET NULL so replying to a
-- message that later gets removed just clears the reference.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER
    REFERENCES messages(id) ON DELETE SET NULL;

-- Chat request support
-- Pending requests from one user to another
CREATE TABLE IF NOT EXISTS chat_requests (
    id            SERIAL PRIMARY KEY,
    from_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message       TEXT,
    status        VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(from_user_id, to_user_id, status)
);

-- Users who have blocked each other
CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id)
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_chat_requests_to_user ON chat_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_requests_status ON chat_requests(status);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
-- Full-text search index for user search
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);