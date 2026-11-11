
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'master.json');

let master = {
  seqCounter: 0,
  records: {}
};

let recentEvents = [];
let activeDevices = new Set();

if (fs.existsSync(DB_FILE)) {
  try {
    master = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (error) {
    console.error('Could not read master.json:', error);
  }
}

function saveMaster() {
  const tempFile = DB_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(master, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

function mergeChanges(incomingChanges) {
  for (const incoming of incomingChanges) {
    const existing = master.records[incoming.id];

    const shouldAccept =
      !existing ||
      incoming.updatedAt > existing.updatedAt ||
      (
        incoming.updatedAt === existing.updatedAt &&
        incoming.deviceId > existing.deviceId
      );

    if (shouldAccept) {
      master.seqCounter++;

      master.records[incoming.id] = {
        ...incoming,
        seq: master.seqCounter
      };
    }
  }
}

function getChangesSince(lastSeq) {
  return Object.values(master.records).filter(
    record => record.seq > lastSeq
  );
}

// Health check
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    seqCounter: master.seqCounter,
    totalRecords: Object.values(master.records).filter(
      r => !Number(r.deleted)
    ).length,
    activeDevices: Array.from(activeDevices),
    recentEvents
  });
});

// Get active records
app.get('/records', (req, res) => {
  res.json(
    Object.values(master.records).filter(
      record => !Number(record.deleted)
    )
  );
});

// Synchronization endpoint
app.post('/sync', (req, res) => {
  try {
    const { deviceId, lastSeq = 0, changes = [] } = req.body;

    if (
      typeof deviceId !== 'string' ||
      !Array.isArray(changes) ||
      !Number.isFinite(Number(lastSeq)) ||
      !changes.every(record =>
        record &&
        typeof record.id === 'string' &&
        typeof record.content === 'string' &&
        Number.isFinite(record.updatedAt) &&
        typeof record.deviceId === 'string'
      )
    ) {
      return res.status(400).json({
        error: 'Invalid sync payload'
      });
    }

    activeDevices.add(deviceId);

    mergeChanges(changes);
    saveMaster();

    const event = {
      timestamp: new Date().toISOString(),
      deviceId,
      receivedCount: changes.length,
      sentCount: getChangesSince(Number(lastSeq)).length
    };

    recentEvents.unshift(event);
    recentEvents = recentEvents.slice(0, 20);

    res.json({
      newSeq: master.seqCounter,
      changes: getChangesSince(Number(lastSeq))
    });

    console.log('Sync received from:', deviceId);
    console.log('Records uploaded:', changes.length);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('SyncNest Mock Hub running!');
  console.log(`Local: http://localhost:${PORT}`);
});
