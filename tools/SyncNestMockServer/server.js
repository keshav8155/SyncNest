const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const app = express();


// Devices currently editing records
const editingPresence = new Map();

const PRESENCE_TIMEOUT = 15000;


app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = 3000;
const DB_FILE = path.join(__dirname, 'master.json');

let master = {
  seqCounter: 0,
  records: {},
  versionSeq: 0,
  versions: {}
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

master.versions = master.versions || {};
master.versionSeq = master.versionSeq || 0;
master.devices = master.devices || {};

function saveMaster() {
  const tempFile = DB_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(master, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

// ---------- PERMANENT DEVICE REGISTRATION ----------

function registerDevice(deviceId, deviceName) {
  const cleanId = deviceId.trim();

  const cleanName =
    typeof deviceName === 'string' && deviceName.trim()
      ? deviceName.trim().slice(0, 30)
      : cleanId;

  master.devices[cleanId] = {
    deviceId: cleanId,
    deviceName: cleanName,
    updatedAt: new Date().toISOString()
  };

  saveMaster();

  return master.devices[cleanId];
}

// Register or update a device name
app.post('/device/register', (req, res) => {
  const { deviceId, deviceName } = req.body;

  if (
    typeof deviceId !== 'string' ||
    !deviceId.trim()
  ) {
    return res.status(400).json({
      error: 'Invalid device ID'
    });
  }

  try {
    const device = registerDevice(deviceId, deviceName);

    res.json({
      success: true,
      device
    });
  } catch (error) {
    console.error('Device registration error:', error);

    res.status(500).json({
      error: 'Could not register device'
    });
  }
});

// Get all registered devices
app.get('/devices', (req, res) => {
  res.json(Object.values(master.devices));
});

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

function addVersions(list) {
  for (const v of list) {
    if (
      !v ||
      typeof v.recordId !== 'string' ||
      typeof v.content !== 'string' ||
      !Number.isFinite(v.updatedAt) ||
      typeof v.deviceId !== 'string'
    ) continue;

    const vid = `${v.recordId}_${v.updatedAt}_${v.deviceId}`;
    if (master.versions[vid]) continue;

    master.versionSeq++;
    master.versions[vid] = {
      vid,
      recordId: v.recordId,
      content: v.content,
      updatedAt: v.updatedAt,
      deleted: Number(v.deleted) ? 1 : 0,
      deviceId: v.deviceId,
      action: v.action || 'received',
      vseq: master.versionSeq
    };
  }
}

function getVersionsSince(lastVersionSeq) {
  return Object.values(master.versions).filter(
    v => v.vseq > lastVersionSeq
  );
}

// Changes since lastSeq, plus the winning record for any edit the hub rejected.
function getResponseChanges(lastSeq, incoming) {
  const out = new Map();

  for (const r of getChangesSince(lastSeq)) out.set(r.id, r);

  for (const c of incoming) {
    const winner = master.records[c.id];
    if (winner && winner.seq <= lastSeq) out.set(winner.id, winner);
  }

  return Array.from(out.values());
}

function getLanIp() {
  if (process.env.HUB_IP) return process.env.HUB_IP;

  const candidates = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) {
        candidates.push(i.address);
      }
    }
  }

  return (
    candidates.find(ip => ip.startsWith('192.168.')) ||
    candidates.find(ip => ip.startsWith('10.')) ||
    candidates.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ||
    candidates[0] ||
    'localhost'
  );
}

app.get('/hub-info', (req, res) => {
  const ip = getLanIp();
  res.json({ ip, port: PORT, url: `http://${ip}:${PORT}` });
});

app.get('/qr.svg', async (req, res) => {
  try {
    const payload = JSON.stringify({
      app: 'syncnest',
      ip: getLanIp(),
      port: PORT
    });
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      width: 260
    });
    res.set('Cache-Control', 'no-store');
    res.type('image/svg+xml').send(svg);
  } catch (error) {
    res.status(500).send('Could not create QR code');
  }
});

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
    const {
      deviceId,
      lastSeq = 0,
      changes = [],
      versions = [],
      lastVersionSeq = 0
    } = req.body;

    if (
      typeof deviceId !== 'string' ||
      !Array.isArray(changes) ||
      !Array.isArray(versions) ||
      !Number.isFinite(Number(lastSeq)) ||
      !Number.isFinite(Number(lastVersionSeq)) ||
      !changes.every(record =>
        record &&
        typeof record.id === 'string' &&
        typeof record.content === 'string' &&
        Number.isFinite(record.updatedAt) &&
        typeof record.deviceId === 'string'
      )
    ) {
      return res.status(400).json({ error: 'Invalid sync payload' });
    }

    activeDevices.add(deviceId);

    mergeChanges(changes);

    // Keep every version: the ones the phone sent, plus every incoming record.
    addVersions(versions);
    addVersions(changes.map(c => ({
      recordId: c.id,
      content: c.content,
      updatedAt: c.updatedAt,
      deleted: c.deleted,
      deviceId: c.deviceId,
      action: 'received'
    })));

    saveMaster();

    const responseChanges = getResponseChanges(Number(lastSeq), changes);

    const event = {
      timestamp: new Date().toISOString(),
      deviceId,
      receivedCount: changes.length,
      sentCount: responseChanges.length
    };

    recentEvents.unshift(event);
    recentEvents = recentEvents.slice(0, 20);

    res.json({
      newSeq: master.seqCounter,
      changes: responseChanges,
      versions: getVersionsSince(Number(lastVersionSeq)),
      newVersionSeq: master.versionSeq
    });

    console.log('Sync received from:', deviceId);
    console.log('Records uploaded:', changes.length);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

app.get('/history/:id', (req, res) => {
  const list = Object.values(master.versions)
    .filter(v => v.recordId === req.params.id)
    .sort((a, b) => b.updatedAt - a.updatedAt || b.deviceId.localeCompare(a.deviceId));
  res.json(list);
});


// ---------- LIVE EDITING PRESENCE ----------

app.post('/presence', (req, res) => {
  const {
    deviceId,
    deviceName,
    recordId,
    editing
  } = req.body;

  if (
    typeof deviceId !== 'string' ||
    typeof recordId !== 'string'
  ) {
    return res.status(400).json({
      error: 'Invalid presence payload'
    });
  }

  if (editing) {
    editingPresence.set(deviceId, {
      deviceId,
      deviceName: deviceName || deviceId,
      recordId,
      lastSeen: Date.now()
    });
  } else {
    editingPresence.delete(deviceId);
  }

  res.json({ success: true });
});

app.get('/presence', (req, res) => {
  const now = Date.now();

  // Remove devices that stopped sending heartbeats
  for (const [id, device] of editingPresence.entries()) {
    if (now - device.lastSeen > PRESENCE_TIMEOUT) {
      editingPresence.delete(id);
    }
  }

  res.json(Array.from(editingPresence.values()));
});


app.listen(PORT, '0.0.0.0', () => {
  console.log('SyncNest Mock Hub running!');
  console.log(`Local: http://localhost:${PORT}`);
});
