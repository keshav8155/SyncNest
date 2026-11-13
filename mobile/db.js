import * as SQLite from 'expo-sqlite';

const DB_NAME = 'syncnest.db';

let database;
let currentDeviceId;

export async function initDb() {
  database = await SQLite.openDatabaseAsync(DB_NAME);

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY NOT NULL,
      content TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      deviceId TEXT NOT NULL,
      seq INTEGER DEFAULT 0,
      pending INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS versions (
      vid TEXT PRIMARY KEY NOT NULL,
      recordId TEXT NOT NULL,
      content TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      deviceId TEXT NOT NULL,
      action TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_versions_record
      ON versions(recordId, updatedAt);
  `);

  let device = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    ['deviceId']
  );

  if (!device) {
    currentDeviceId = 'Phone_' + Math.random().toString(36).substring(2, 8);
    await database.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?)',
      ['deviceId', currentDeviceId]
    );
  } else {
    currentDeviceId = device.value;
  }

  const seq = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    ['lastSeq']
  );

  if (!seq) {
    await database.runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?)',
      ['lastSeq', '0']
    );
  }

  // Backfill: give records that existed before versions a first version.
  await database.execAsync(`
    INSERT OR IGNORE INTO versions
      (vid, recordId, content, updatedAt, deleted, deviceId, action)
    SELECT id || '_' || updatedAt || '_' || deviceId,
           id, content, updatedAt, deleted, deviceId, 'created'
    FROM records;
  `);

  return currentDeviceId;
}

export function getDeviceId() {
  return currentDeviceId;
}

export async function getLastSeq() {
  const result = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    ['lastSeq']
  );
  return Number(result?.value || 0);
}

async function getMetaNumber(key) {
  const r = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    [key]
  );
  return Number(r?.value || 0);
}

async function setMeta(key, value) {
  await database.runAsync(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    [key, String(value)]
  );
}

export async function getLastVersionSeq() {
  return await getMetaNumber('lastVersionSeq');
}

// ---------- version helper (append-only, duplicates are ignored) ----------

async function addVersion(rec, action) {
  const vid = `${rec.id}_${rec.updatedAt}_${rec.deviceId}`;
  await database.runAsync(
    `INSERT OR IGNORE INTO versions
     (vid, recordId, content, updatedAt, deleted, deviceId, action)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      vid,
      rec.id,
      rec.content,
      rec.updatedAt,
      Number(rec.deleted) || 0,
      rec.deviceId,
      action,
    ]
  );
}

// ---------- create / edit / delete / restore ----------

export async function saveRecordLocally(
  title,
  body,
  priority,
  location,
  status = 'To do'
) {
  const now = Date.now();

  const id =
    currentDeviceId + '_' + now + '_' +
    Math.random().toString(36).substring(2, 7);

  const content = JSON.stringify({ title, body, priority, status, location });

  const record = {
    id,
    content,
    updatedAt: now,
    deleted: 0,
    deviceId: currentDeviceId,
    seq: 0,
    pending: 1,
  };

  await database.runAsync(
    `INSERT INTO records
     (id, content, updatedAt, deleted, deviceId, seq, pending)
     VALUES (?, ?, ?, 0, ?, 0, 1)`,
    [id, content, now, currentDeviceId]
  );

  await addVersion(record, 'created');

  return record;
}

// Returns true if something changed, false if the content was identical.
export async function updateRecordLocally(
  id,
  title,
  body,
  priority,
  location,
  status,
  action = 'edited'
) {
  const existing = await database.getFirstAsync(
    'SELECT * FROM records WHERE id = ?',
    [id]
  );
  if (!existing) return false;

  const content = JSON.stringify({ title, body, priority, status, location });

  if (existing.content === content && Number(existing.deleted) === 0) {
    return false;
  }

  // Always newer than the version being edited, even if this clock is behind.
  const now = Math.max(Date.now(), existing.updatedAt + 1);

  await database.runAsync(
    `UPDATE records
     SET content = ?, updatedAt = ?, deviceId = ?, pending = 1
     WHERE id = ?`,
    [content, now, currentDeviceId, id]
  );

  await addVersion(
    { id, content, updatedAt: now, deleted: 0, deviceId: currentDeviceId },
    action
  );

  return true;
}

// Soft delete: the row stays, it is only flagged.
export async function deleteRecordLocally(id) {
  const existing = await database.getFirstAsync(
    'SELECT * FROM records WHERE id = ?',
    [id]
  );
  if (!existing) return false;

  const now = Math.max(Date.now(), existing.updatedAt + 1);

  await database.runAsync(
    `UPDATE records
     SET deleted = 1, updatedAt = ?, deviceId = ?, pending = 1
     WHERE id = ?`,
    [now, currentDeviceId, id]
  );

  await addVersion(
    { id, content: existing.content, updatedAt: now, deleted: 1, deviceId: currentDeviceId },
    'deleted'
  );

  return true;
}

export async function restoreRecordLocally(id) {
  const existing = await database.getFirstAsync(
    'SELECT * FROM records WHERE id = ?',
    [id]
  );
  if (!existing) return false;

  const now = Math.max(Date.now(), existing.updatedAt + 1);

  await database.runAsync(
    `UPDATE records
     SET deleted = 0, updatedAt = ?, deviceId = ?, pending = 1
     WHERE id = ?`,
    [now, currentDeviceId, id]
  );

  await addVersion(
    { id, content: existing.content, updatedAt: now, deleted: 0, deviceId: currentDeviceId },
    'restored'
  );

  return true;
}

// ---------- reading ----------

// Includes deleted rows. App.js filters them into the list / Recently deleted.
export async function getAllRecords() {
  return await database.getAllAsync(
    'SELECT * FROM records ORDER BY updatedAt DESC'
  );
}

export async function getPendingRecords() {
  return await database.getAllAsync(
    'SELECT * FROM records WHERE pending = 1'
  );
}

// Newest first. The first row is the current version.
export async function getVersions(recordId) {
  return await database.getAllAsync(
    `SELECT * FROM versions
     WHERE recordId = ?
     ORDER BY updatedAt DESC, deviceId DESC`,
    [recordId]
  );
}

// ---------- syncing ----------

// Takes the uploaded record objects. Only clears pending if the record
// has not been edited again since it was uploaded.
export async function markSynced(uploadedRecords) {
  for (const r of uploadedRecords) {
    await database.runAsync(
      'UPDATE records SET pending = 0 WHERE id = ? AND updatedAt = ?',
      [r.id, r.updatedAt]
    );
  }
}

export async function applyServerResponse(newSeq, changes) {
  for (const incoming of changes) {
    const local = await database.getFirstAsync(
      'SELECT * FROM records WHERE id = ?',
      [incoming.id]
    );

    // Keep every version we hear about, whether it wins or loses.
    await addVersion(
      {
        id: incoming.id,
        content: incoming.content,
        updatedAt: incoming.updatedAt,
        deleted: incoming.deleted,
        deviceId: incoming.deviceId,
      },
      'received'
    );

    const shouldUpdate =
      !local ||
      incoming.updatedAt > local.updatedAt ||
      (
        incoming.updatedAt === local.updatedAt &&
        incoming.deviceId > local.deviceId
      );

    if (shouldUpdate) {
      await database.runAsync(
        `INSERT OR REPLACE INTO records
         (id, content, updatedAt, deleted, deviceId, seq, pending)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [
          incoming.id,
          incoming.content,
          incoming.updatedAt,
          Number(incoming.deleted) || 0,
          incoming.deviceId,
          incoming.seq,
        ]
      );
    }
  }

  await database.runAsync(
    'UPDATE meta SET value = ? WHERE key = ?',
    [String(newSeq), 'lastSeq']
  );
}

// Versions created on this phone that the hub has not received yet.
export async function getPendingVersions() {
  const last = await getMetaNumber('lastUploadedVersionRow');

  return await database.getAllAsync(
    `SELECT vid, recordId, content, updatedAt, deleted, deviceId, action,
            rowid AS rid
     FROM versions
     WHERE rowid > ? AND COALESCE(action, '') != 'received'
     ORDER BY rowid`,
    [last]
  );
}

export async function markVersionsUploaded(uploaded) {
  if (uploaded.length === 0) return;
  const maxRid = Math.max(...uploaded.map(v => v.rid));
  await setMeta('lastUploadedVersionRow', maxRid);
}

export async function applyServerVersions(newVersionSeq, versions) {
  for (const v of versions) {
    await addVersion(
      {
        id: v.recordId,
        content: v.content,
        updatedAt: v.updatedAt,
        deleted: v.deleted,
        deviceId: v.deviceId,
      },
      'received'
    );
  }
  await setMeta('lastVersionSeq', newVersionSeq);
}

export async function getHubIp() {
  const r = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    ['hubIp']
  );
  return r?.value || null;
}

export async function setHubIp(ip) {
  await setMeta('hubIp', ip);
}


// ---------- APP SETTINGS ----------

export async function getSetting(key, fallback = null) {
  const result = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    [`setting:${key}`]
  );

  return result?.value ?? fallback;
}

export async function setSetting(key, value) {
  await database.runAsync(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    [`setting:${key}`, String(value)]
  );
}

export async function getDeviceName() {
  return await getSetting(
    'deviceName',
    currentDeviceId || 'Field Device'
  );
}

export async function setDeviceName(name) {
  const cleanName = name.trim();

  if (!cleanName) {
    throw new Error('Device name cannot be empty');
  }

  await setSetting('deviceName', cleanName);
}
