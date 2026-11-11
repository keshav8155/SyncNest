
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
  `);

  let device = await database.getFirstAsync(
    'SELECT value FROM meta WHERE key = ?',
    ['deviceId']
  );

  if (!device) {
    currentDeviceId =
      'Phone_' + Math.random().toString(36).substring(2, 8);

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

  const content = JSON.stringify({
    title,
    body,
    priority,
    status,
    location
  });

  await database.runAsync(
    `INSERT INTO records
    (id, content, updatedAt, deleted, deviceId, seq, pending)
    VALUES (?, ?, ?, 0, ?, 0, 1)`,
    [id, content, now, currentDeviceId]
  );

  return {
    id,
    content,
    updatedAt: now,
    deleted: 0,
    deviceId: currentDeviceId,
    seq: 0,
    pending: 1
  };
}

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

export async function markSynced(syncedIds) {
  for (const id of syncedIds) {
    await database.runAsync(
      'UPDATE records SET pending = 0 WHERE id = ?',
      [id]
    );
  }
}

export async function applyServerResponse(newSeq, changes) {
  for (const incoming of changes) {
    const local = await database.getFirstAsync(
      'SELECT * FROM records WHERE id = ?',
      [incoming.id]
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
          incoming.deleted,
          incoming.deviceId,
          incoming.seq
        ]
      );
    }
  }

  await database.runAsync(
    'UPDATE meta SET value = ? WHERE key = ?',
    [String(newSeq), 'lastSeq']
  );
}
