-- SQLite database initialization script
-- Converted from PostgreSQL schema

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;



CREATE TABLE IF NOT EXISTS assistant (
    assistant_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    graph_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    config TEXT DEFAULT '{}' NOT NULL,
    metadata TEXT DEFAULT '{}' NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    name TEXT,
    description TEXT
);



CREATE TABLE IF NOT EXISTS assistant_versions (
    assistant_id TEXT NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    graph_id TEXT NOT NULL,
    config TEXT DEFAULT '{}' NOT NULL,
    metadata TEXT DEFAULT '{}' NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    name TEXT,
    PRIMARY KEY (assistant_id, version),
    FOREIGN KEY (assistant_id) REFERENCES assistant(assistant_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS checkpoint_blobs (
    thread_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BLOB,
    checkpoint_ns TEXT DEFAULT '' NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version),
    FOREIGN KEY (thread_id) REFERENCES thread(thread_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkpoint_migrations (
    v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BLOB NOT NULL,
    checkpoint_ns TEXT DEFAULT '' NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx),
    FOREIGN KEY (thread_id) REFERENCES thread(thread_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    run_id TEXT,
    parent_checkpoint_id TEXT,
    checkpoint TEXT NOT NULL,
    type TEXT,
    metadata TEXT DEFAULT '{}' NOT NULL,
    checkpoint_ns TEXT DEFAULT '' NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id),
    FOREIGN KEY (run_id) REFERENCES run(run_id) ON DELETE CASCADE,
    FOREIGN KEY (thread_id) REFERENCES thread(thread_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cron (
    cron_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    assistant_id TEXT,
    thread_id TEXT,
    user_id TEXT,
    payload TEXT DEFAULT '{}' NOT NULL,
    schedule TEXT NOT NULL,
    next_run_date DATETIME,
    end_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT DEFAULT '{}' NOT NULL,
    FOREIGN KEY (assistant_id) REFERENCES assistant(assistant_id) ON DELETE CASCADE,
    FOREIGN KEY (thread_id) REFERENCES thread(thread_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS run (
    run_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    thread_id TEXT NOT NULL,
    assistant_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT DEFAULT '{}' NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    kwargs TEXT NOT NULL,
    multitask_strategy TEXT DEFAULT 'reject' NOT NULL,
    FOREIGN KEY (assistant_id) REFERENCES assistant(assistant_id) ON DELETE CASCADE,
    FOREIGN KEY (thread_id) REFERENCES thread(thread_id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    dirty BOOLEAN NOT NULL
);


CREATE TABLE IF NOT EXISTS store (
    prefix TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    ttl_minutes INTEGER,
    PRIMARY KEY (prefix, key)
);


CREATE TABLE IF NOT EXISTS thread (
    thread_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT DEFAULT '{}' NOT NULL,
    status TEXT DEFAULT 'idle' NOT NULL,
    config TEXT DEFAULT '{}' NOT NULL,
    "values" TEXT,
    interrupts TEXT DEFAULT '{}' NOT NULL
);


CREATE TABLE IF NOT EXISTS thread_ttl (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    thread_id TEXT NOT NULL,
    strategy TEXT DEFAULT 'delete' NOT NULL,
    ttl_minutes REAL NOT NULL CHECK (ttl_minutes >= 0),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at DATETIME GENERATED ALWAYS AS (datetime(created_at, '+' || ttl_minutes || ' minutes')) STORED,
    FOREIGN KEY (thread_id) REFERENCES thread(thread_id) ON DELETE CASCADE
);

--
-- Indexes
--

CREATE INDEX IF NOT EXISTS assistant_created_at_idx ON assistant (created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_graph_id_idx ON assistant (graph_id, created_at DESC);
CREATE INDEX IF NOT EXISTS checkpoints_checkpoint_id_idx ON checkpoints (thread_id, checkpoint_id DESC);
CREATE INDEX IF NOT EXISTS checkpoints_run_id_idx ON checkpoints (run_id);
CREATE INDEX IF NOT EXISTS idx_store_expires_at ON store (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_thread_ttl_expires_at ON thread_ttl (expires_at);
CREATE INDEX IF NOT EXISTS idx_thread_ttl_thread_id ON thread_ttl (thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_ttl_thread_strategy ON thread_ttl (thread_id, strategy);
CREATE INDEX IF NOT EXISTS run_assistant_id_idx ON run (assistant_id);
CREATE INDEX IF NOT EXISTS run_pending_idx ON run (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS run_thread_id_status_idx ON run (thread_id, status);
CREATE INDEX IF NOT EXISTS store_prefix_idx ON store (prefix);
CREATE INDEX IF NOT EXISTS thread_created_at_idx ON thread (created_at DESC);
CREATE INDEX IF NOT EXISTS thread_status_idx ON thread (status, created_at DESC);


-- Triggers

-- Triggers for updated_at timestamps
CREATE TRIGGER IF NOT EXISTS assistant_updated_at_trigger 
    AFTER UPDATE ON assistant 
    BEGIN 
        UPDATE assistant SET updated_at = CURRENT_TIMESTAMP WHERE assistant_id = NEW.assistant_id;
    END;

CREATE TRIGGER IF NOT EXISTS cron_updated_at_trigger 
    AFTER UPDATE ON cron 
    BEGIN 
        UPDATE cron SET updated_at = CURRENT_TIMESTAMP WHERE cron_id = NEW.cron_id;
    END;

CREATE TRIGGER IF NOT EXISTS run_updated_at_trigger 
    AFTER UPDATE ON run 
    BEGIN 
        UPDATE run SET updated_at = CURRENT_TIMESTAMP WHERE run_id = NEW.run_id;
    END;

CREATE TRIGGER IF NOT EXISTS thread_updated_at_trigger 
    AFTER UPDATE ON thread 
    BEGIN 
        UPDATE thread SET updated_at = CURRENT_TIMESTAMP WHERE thread_id = NEW.thread_id;
    END;

CREATE TRIGGER IF NOT EXISTS store_updated_at_trigger 
    AFTER UPDATE ON store 
    BEGIN 
        UPDATE store SET updated_at = CURRENT_TIMESTAMP WHERE prefix = NEW.prefix AND key = NEW.key;
    END;

