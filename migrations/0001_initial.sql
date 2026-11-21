CREATE TABLE folders (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE vocabulary (
    id TEXT PRIMARY KEY NOT NULL,
    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    word TEXT NOT NULL CHECK (length(trim(word)) BETWEEN 1 AND 200),
    example TEXT NOT NULL DEFAULT '' CHECK (length(example) <= 10000),
    meaning TEXT NOT NULL CHECK (length(trim(meaning)) BETWEEN 1 AND 2000),
    translation TEXT NOT NULL DEFAULT '' CHECK (length(translation) <= 10000),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 10000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX vocabulary_folder_order ON vocabulary(folder_id, sort_order, id);

CREATE TABLE conversations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    speaker TEXT NOT NULL CHECK (speaker IN ('me', 'partner')),
    content TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 10000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX messages_conversation_order ON messages(conversation_id, sort_order, id);

-- Child changes invalidate stale parent edits/deletions, including moves.
CREATE TRIGGER vocabulary_insert_parent AFTER INSERT ON vocabulary BEGIN
    UPDATE folders SET version = version + 1, updated_at = MAX(updated_at, NEW.updated_at)
    WHERE id = NEW.folder_id;
END;
CREATE TRIGGER vocabulary_update_parent AFTER UPDATE ON vocabulary BEGIN
    UPDATE folders SET version = version + 1, updated_at = MAX(updated_at, NEW.updated_at)
    WHERE id = OLD.folder_id OR id = NEW.folder_id;
END;
CREATE TRIGGER vocabulary_delete_parent AFTER DELETE ON vocabulary BEGIN
    UPDATE folders SET version = version + 1,
        updated_at = MAX(updated_at, CAST(unixepoch('subsec') * 1000 AS INTEGER))
    WHERE id = OLD.folder_id;
END;
CREATE TRIGGER messages_insert_parent AFTER INSERT ON messages BEGIN
    UPDATE conversations SET version = version + 1, updated_at = MAX(updated_at, NEW.updated_at)
    WHERE id = NEW.conversation_id;
END;
CREATE TRIGGER messages_update_parent AFTER UPDATE ON messages BEGIN
    UPDATE conversations SET version = version + 1, updated_at = MAX(updated_at, NEW.updated_at)
    WHERE id = OLD.conversation_id OR id = NEW.conversation_id;
END;
CREATE TRIGGER messages_delete_parent AFTER DELETE ON messages BEGIN
    UPDATE conversations SET version = version + 1,
        updated_at = MAX(updated_at, CAST(unixepoch('subsec') * 1000 AS INTEGER))
    WHERE id = OLD.conversation_id;
END;
