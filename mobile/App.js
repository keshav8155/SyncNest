import { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';

import { CameraView, useCameraPermissions } from 'expo-camera';

import { StatusBar } from 'expo-status-bar';

import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  initDb,
  getDeviceId,
  getLastSeq,
  getAllRecords,
  getPendingRecords,
  saveRecordLocally,
  updateRecordLocally,
  deleteRecordLocally,
  restoreRecordLocally,
  getVersions,
  markSynced,
  applyServerResponse,
  getPendingVersions,
  markVersionsUploaded,
  applyServerVersions,
  getLastVersionSeq,
  getHubIp,
  setHubIp,
  getSetting,
  setSetting,
  getDeviceName,
  setDeviceName,
} from './db';

// ---------------- CONFIGURATION ----------------

const DEFAULT_PC_IP = '192.168.1.8';
const SERVER_PORT = 3000;

const DARK_COLORS = {
  bg: '#12141A',
  card: '#1E2128',
  border: '#2A2E37',
  text: '#FFFFFF',
  muted: '#9AA0AB',
  teal: '#4FD1C5',
  tealDark: '#10302E',
  green: '#6FD99B',
  amber: '#F6CF7A',
  red: '#FF6B6B',
};

const LIGHT_COLORS = {
  bg: '#F4F7F8',
  card: '#FFFFFF',
  border: '#E1E8EA',
  text: '#17252A',
  muted: '#718087',
  teal: '#159E96',
  tealDark: '#DDF4F1',
  green: '#238653',
  amber: '#B7791F',
  red: '#D64545',
};

const PRIORITY = {
  Critical: { bg: '#5C1A1A', fg: '#FF6B6B' },
  High: { bg: '#3A1F1F', fg: '#F28B82' },
  Medium: { bg: '#3A2F14', fg: '#F6CF7A' },
  Low: { bg: '#17361F', fg: '#7EDC9B' },
};

const STATUS = {
  'To do': { bg: '#2B2E36', fg: '#C5C9D3' },
  Doing: { bg: '#232B3E', fg: '#A8B8F0' },
  Done: { bg: '#17361F', fg: '#7EDC9B' },
};

const FILTERS = ['All', 'To do', 'Doing', 'Done'];

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

function formatDate(ms) {
  return new Date(ms).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------- MAIN APP ----------------

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
  }


function MainApp() {

  const insets = useSafeAreaInsets();

  const [theme, setTheme] = useState('dark');

  const C = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  const styles = useMemo(() => createStyles(C), [C]);

  const [cards, setCards] = useState([]);
  const [deviceId, setDeviceId] = useState('Loading...');
  const [deviceName, setDeviceNameState] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [lastSeq, setLastSeq] = useState(0);

  const [autoSync, setAutoSync] = useState(true);
  const syncingRef = useRef(false);
  const pcIpRef = useRef(DEFAULT_PC_IP);
  const syncNowRef = useRef(null);

  const [pcIp, setPcIp] = useState(DEFAULT_PC_IP);
  const [filter, setFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState('newest');

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [trashVisible, setTrashVisible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingDevices, setEditingDevices] = useState([]);
  const [toast, setToast] = useState('');

  // Form fields
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('To do');

  // QR scanner
  const [scanVisible, setScanVisible] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  // Toggle Theme

  async function toggleTheme() {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  setTheme(nextTheme);

  try {
    await setSetting('theme', nextTheme);
  } catch (error) {
    console.log('Theme save error:', error);
  }
}

  // ---------------- DATABASE INITIALIZATION ----------------

  useEffect(() => {
    let mounted = true;

    async function startApp() {
      try {
        const id = await initDb();
        const savedTheme = await getSetting('theme', 'dark');
        const records = await getAllRecords();
        const seq = await getLastSeq();
        const savedIp = await getHubIp();

        if (mounted) {
          if (savedTheme === 'light' || savedTheme === 'dark') {
            setTheme(savedTheme);
          }
          setDeviceId(id);
          setCards(records);
          setLastSeq(seq);
          if (savedIp) {
            setPcIp(savedIp);
            pcIpRef.current = savedIp;
          }
        }
      } catch (error) {
        console.log('Database initialization error:', error);
        Alert.alert(
          'Database Error',
          'Could not initialize local storage.'
        );
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    startApp();

    return () => {
      mounted = false;
    };
  }, []);

  // ---------------- REFRESH CARDS ----------------

  async function refreshCards() {
    try {
      const records = await getAllRecords();
      const seq = await getLastSeq();

      setCards(records);
      setLastSeq(seq);
    } catch (error) {
      console.log('Refresh error:', error);
    }
  }

  // ---------------- TOAST MESSAGE ----------------

  function showToast(message) {
    setToast(message);

    setTimeout(() => {
      setToast('');
    }, 3000);
  }

  // Register this device permanently on the PC Hub
async function registerDeviceWithHub(name, ip = pcIpRef.current) {
  if (!deviceId || deviceId === 'Loading...') return;

  const cleanName = (name || deviceId).trim();

  try {
    const response = await fetch(
      `http://${ip.trim()}:${SERVER_PORT}/device/register`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          deviceName: cleanName,
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Device registration failed');
    }

    console.log('Device registered on PC Hub:', cleanName);
  } catch (error) {
    console.log('Device registration error:', error.message);
  }
}

  // ---------------- LIVE EDITING PRESENCE ----------------

  async function sendEditingPresence(recordId, editing) {
    if (!recordId) return;

    try {
      await fetch(
        `http://${pcIpRef.current.trim()}:${SERVER_PORT}/presence`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: getDeviceId(),
            deviceName: deviceName || deviceId,
            recordId,
            editing,
          }),
        }
      );
    } catch (error) {
      console.log('Presence update error:', error?.message || error);
    }
  }

  function closeEditor() {
    if (editingId) {
      sendEditingPresence(editingId, false);
    }

    setShowHistory(false);
    setModalVisible(false);
  }

  // ---------------- OPEN NEW / EDIT ----------------

  function openNew() {
    setEditingId(null);
    setShowHistory(false);
    setTitle('');
    setBody('');
    setLocation('');
    setPriority('Medium');
    setStatus('To do');
    setModalVisible(true);
  }

  function openEdit(item) {
    let c = {};
    try {
      c = JSON.parse(item.content);
    } catch {}

    setEditingId(item.id);
    sendEditingPresence(item.id, true);
    setShowHistory(false);
    setTitle(c.title || '');
    setBody(c.body || '');
    setLocation(c.location || '');
    setPriority(c.priority || 'Medium');
    setStatus(c.status || 'To do');
    setModalVisible(true);
  }

  // ---------------- SAVE (NEW OR EDIT) ----------------

  async function handleSaveRecord() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a record title.');
      return;
    }

    try {
      let message;

      if (editingId) {
        const changed = await updateRecordLocally(
          editingId,
          title.trim(),
          body.trim(),
          priority,
          location.trim(),
          status
        );
        message = changed
          ? 'Record updated · New version saved'
          : 'No changes to save';
      } else {
        await saveRecordLocally(
          title.trim(),
          body.trim(),
          priority,
          location.trim(),
          status
        );
        message = 'Record saved · Pending sync';
      }

      await refreshCards();
      
      if (editingId) {
        sendEditingPresence(editingId, false);
      }

      setEditingId(null);
      setTitle('');
      setBody('');
      setLocation('');
      setPriority('Medium');
      setStatus('To do');

      setModalVisible(false);

      showToast(message);
    } catch (error) {
      console.log('Save error:', error);
      Alert.alert('Error', 'Could not save the record.');
    }
  }

  // ---------------- SOFT DELETE / RESTORE ----------------

  function handleDelete() {
    Alert.alert(
      'Move to Recently deleted?',
      'It will be hidden on all devices after the next sync. You can restore it any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Move',
          style: 'destructive',
          onPress: async () => {
            await deleteRecordLocally(editingId);
            await refreshCards();

            if (editingId) {
              sendEditingPresence(editingId, false);
            }

            setEditingId(null);
            setModalVisible(false);
            showToast('Moved to Recently deleted · Pending sync');
          },
        },
      ]
    );
  }

  async function handleRestoreDeleted(id) {
    await restoreRecordLocally(id);
    await refreshCards();
    showToast('Record restored · Pending sync');
  }

  // ---------------- VERSION HISTORY ----------------

  async function openHistory() {
    try {
      const v = await getVersions(editingId);
      setVersions(v);
      setShowHistory(true);
    } catch (error) {
      console.log('History error:', error);
      Alert.alert('Error', 'Could not load version history.');
    }
  }

  async function handleRestoreVersion(v) {
    let c = {};
    try {
      c = JSON.parse(v.content);
    } catch {}

    const changed = await updateRecordLocally(
      editingId,
      c.title || '',
      c.body || '',
      c.priority || 'Medium',
      c.location || '',
      c.status || 'To do',
      'restored'
    );

    await refreshCards();

    if (editingId) {
      sendEditingPresence(editingId, false);
    }

    setShowHistory(false);
    setModalVisible(false);
    setEditingId(null);

    showToast(
      changed ? 'Version restored · Pending sync' : 'Already the current content'
    );
  }

  // QR Scanner

  async function openScanner() {
  if (!permission?.granted) {
    const res = await requestPermission();
    if (!res.granted) {
      Alert.alert('Camera needed', 'Allow camera access to scan the hub QR code.');
      return;
    }
  }
  scannedRef.current = false;
  setScanVisible(true);
}

async function handleScanned({ data }) {
  if (scannedRef.current) return;

  try {
    const info = JSON.parse(data);

    if (
      info.app !== 'syncnest' ||
      typeof info.ip !== 'string' ||
      !/^[\w.-]+$/.test(info.ip)
    ) {
      return; // not a SyncNest code, keep scanning
    }

    scannedRef.current = true;
    setPcIp(info.ip);
    pcIpRef.current = info.ip;
    await setHubIp(info.ip);
    setScanVisible(false);
    showToast(`Hub set to ${info.ip}`);
  } catch {
    // not JSON, ignore and keep scanning
  }
}

  // ---------------- SYNC WITH PC HUB ----------------

  async function syncNow({ silent = false } = {}) {
  if (syncingRef.current) return;

  syncingRef.current = true;
  if (!silent) setSyncing(true);

  // Give up quickly if the hub is unreachable
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const changes = await getPendingRecords();
  const pendingVersions = await getPendingVersions();
  const currentSeq = await getLastSeq();
  const currentVersionSeq = await getLastVersionSeq();

    const response = await fetch(
      `http://${pcIpRef.current.trim()}:${SERVER_PORT}/sync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          lastSeq: currentSeq,
          changes,
          versions: pendingVersions,
          lastVersionSeq: currentVersionSeq,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const result = await response.json();

    if (
      typeof result.newSeq !== 'number' ||
      !Array.isArray(result.changes)
    ) {
      throw new Error('Invalid sync response from PC Hub');
    }

    await markSynced(changes);
    await applyServerResponse(result.newSeq, result.changes);

    // Version history (only if the hub supports it)
    if (
      typeof result.newVersionSeq === 'number' &&
      Array.isArray(result.versions)
    ) {
      await applyServerVersions(result.newVersionSeq, result.versions);
      await markVersionsUploaded(pendingVersions);
    }

    const myId = getDeviceId();
    const uploaded = changes.length;
    const downloaded = result.changes.filter(
      (r) => r.deviceId !== myId
    ).length;

    if (uploaded > 0 || result.changes.length > 0) {
      await refreshCards();
    }

    setConnected(true);

    if (!silent) {
      showToast(
        uploaded > 0 || downloaded > 0
          ? `Sync complete · ↑${uploaded} ↓${downloaded}`
          : 'Sync complete · Up to date'
      );
    } else if (uploaded > 0 || downloaded > 0) {
      showToast(`Synced · ↑${uploaded} ↓${downloaded}`);
    }
  } catch (error) {
    console.log('Sync error:', error?.message || error);
    setConnected(false);

    if (!silent) {
      Alert.alert(
        'Sync Failed',
        'Could not connect to the PC Hub. Check the IP address, Wi-Fi and server status.'
      );
    }
  } finally {
    clearTimeout(timer);
    syncingRef.current = false;
    if (!silent) setSyncing(false);
  }
}

 // ---------------- AUTO SYNC ----------------

  syncNowRef.current = syncNow;

  useEffect(() => {
    if (loading || !autoSync) return;

    const run = () => syncNowRef.current({ silent: true });

    run(); // once right away
    const id = setInterval(run, 2000);

    return () => clearInterval(id);
  }, [loading, autoSync]);


  // ---------------- DEVICE NAME ----------------

  // Load saved device name
  useEffect(() => {
    if (loading) return;

    let active = true;

    async function loadDeviceName() {
      try {
        const name = await getDeviceName();

        if (active) {
          setDeviceNameState(name);
        }
      } catch (error) {
        console.log('Device name load error:', error);
      }
    }

    loadDeviceName();

    return () => {
      active = false;
    };
  }, [loading]);

  // Automatically register device with PC Hub
  useEffect(() => {
    if (
      loading ||
      !deviceId ||
      deviceId === 'Loading...' ||
      !deviceName
    ) {
      return;
    }

    registerDeviceWithHub(deviceName, pcIp);
  }, [loading, deviceId, deviceName, pcIp]);


  // ---------------- CHECK OTHER DEVICES EDITING ----------------

  useEffect(() => {
    if (loading) return;

    let active = true;

    async function checkEditingDevices() {
      try {
        const response = await fetch(
          `http://${pcIpRef.current.trim()}:${SERVER_PORT}/presence`
        );

        if (!response.ok) return;

        const devices = await response.json();

        if (active && Array.isArray(devices)) {
          setEditingDevices(
            devices.filter(
              (device) => device.deviceId !== getDeviceId()
            )
          );
        }
      } catch {
        // Hub may temporarily be unavailable
      }
    }

    checkEditingDevices();

    const interval = setInterval(checkEditingDevices, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [loading, pcIp]);

  // ---------------- FILTER RECORDS ----------------

  const activeCards = cards.filter(
    (record) => Number(record.deleted) === 0
  );

  const deletedCards = cards.filter(
    (record) => Number(record.deleted) === 1
  );

  const visibleCards = activeCards.filter((record) => {
  let content = {};

  try {
    content = JSON.parse(record.content);
  } catch {
    return false;
  }

  // Apply status filter
  const matchesStatus =
    filter === 'All' || content.status === filter;

  // Search title, description, and location
  const query = searchQuery.trim().toLowerCase();

  const matchesSearch =
    !query ||
    (content.title || '').toLowerCase().includes(query) ||
    (content.body || '').toLowerCase().includes(query) ||
    (content.location || '').toLowerCase().includes(query);

  return matchesStatus && matchesSearch;
});

// SORT VISIBLE RECORDS
visibleCards.sort((a, b) => {
  if (sortMode === 'oldest') {
    return new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0);
  }

  if (sortMode === 'priority') {
    const priorityRank = {
      High: 3,
      Medium: 2,
      Low: 1,
    };

    const contentA = JSON.parse(a.content || '{}');
    const contentB = JSON.parse(b.content || '{}');

    return (
      (priorityRank[contentB.priority] || 0) -
      (priorityRank[contentA.priority] || 0)
    );
  }

  // Default: newest first
  return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
});

  // Counts deleted records too, because they also need to sync.
  const pendingCount = cards.filter(
    (record) => Number(record.pending) === 1
  ).length;

  // ---------------- CARD COMPONENT ----------------

  function renderCard({ item }) {
    let content = {};

    try {
      content = JSON.parse(item.content);
    } catch {
      content = {};
    }

    const p = PRIORITY[content.priority] || PRIORITY.Medium;
    const s = STATUS[content.status] || STATUS['To do'];

    const isPending = Number(item.pending) === 1;
    const editors = editingDevices.filter(
      (device) => device.recordId === item.id
    );

    return (
      <Pressable
        style={[
          styles.card,
          editors.length > 0 && styles.cardBeingEdited,
        ]}
        onPress={() => openEdit(item)}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardTitle}>
            {content.title || 'Untitled Record'}
          </Text>

          <Text style={styles.cardTime}>
            {new Date(item.updatedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>

        <Text style={styles.cardBody}>
          {content.body || 'No description'}
        </Text>

        <Text style={styles.cardLocation}>
          📍 {content.location || 'Location not specified'}
        </Text>

        <View style={styles.cardBottom}>
          <View style={styles.tags}>
            <Text
              style={[
                styles.tag,
                { backgroundColor: p.bg, color: p.fg },
              ]}
            >
              {content.priority || 'Medium'}
            </Text>

            <Text
              style={[
                styles.tag,
                { backgroundColor: s.bg, color: s.fg },
              ]}
            >
              {content.status || 'To do'}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
  <Text
    style={[
      styles.syncLabel,
      { color: isPending ? C.amber : C.green },
    ]}
  >
    {isPending ? '◷ Pending' : '✓ Synced'}
  </Text>

  {editors.length > 0 && (
    <Text
      style={{
        color: C.teal,
        fontSize: 10,
        fontWeight: '800',
        marginTop: 6,
      }}
    >
      ● {editors.map((device) => device.deviceName).join(', ')} editing
    </Text>
  )}
</View>
        </View>
      </Pressable>
    );
  }

  // ---------------- DELETED CARD (RECENTLY DELETED SCREEN) ----------------

  function renderDeletedCard({ item }) {
    let c = {};
    try {
      c = JSON.parse(item.content);
    } catch {}

    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{c.title || 'Untitled Record'}</Text>
        <Text style={styles.cardBody}>{c.body || 'No description'}</Text>

        <View style={styles.cardBottom}>
          <Text style={styles.cardLocation}>
            Deleted {formatDate(item.updatedAt)}
          </Text>

          <Pressable onPress={() => handleRestoreDeleted(item.id)}>
            <Text style={styles.restoreText}>Restore</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---------------- LOADING SCREEN ----------------

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={C.teal} />
        <Text style={styles.loadingText}>
          Initializing SyncNest...
        </Text>
      </View>
    );
  }

  // ---------------- MAIN SCREEN ----------------

  return (
    <KeyboardAvoidingView
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 12) },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

      {/* HEADER */}

    <View style={styles.headerRow}>
      <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
        <Text
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          SyncNest
        </Text>

        <Text style={styles.subtitle}>
          Field Operations · {deviceName || deviceId}
        </Text>
      </View>

      <View style={styles.headerActions}>
        <Pressable
          style={styles.themeButton}
          onPress={toggleTheme}
        >
          <Text style={styles.themeButtonText}>
            {theme === 'dark' ? '☀' : '☾'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.themeButton}
          onPress={() => {
            setDeviceNameInput(deviceName);
            setSettingsVisible(true);
          }}
        >
          <Text style={styles.themeButtonText}>⚙</Text>
        </Pressable>

        <View
          style={[
            styles.connectionBadge,
            {
              backgroundColor: connected
                ? (theme === 'dark' ? '#173A2B' : '#DDF4E5')
                : (theme === 'dark' ? '#352C1C' : '#FFF1D6'),
            },
          ]}
        >
          <View
            style={[
              styles.connectionDot,
              {
                backgroundColor: connected ? C.green : C.amber,
              },
            ]}
          />

          <Text
            style={{
              color: connected
                ? (theme === 'dark' ? C.green : '#238653')
                : (theme === 'dark' ? C.amber : '#946200'),
              fontWeight: '700',
              fontSize: 12,
            }}
          >
            {connected ? 'Connected' : 'Local'}
          </Text>
        </View>
      </View>
    </View>

      {/* CARD LIST */}

      <FlatList
        ListHeaderComponent={
          <View>
            {/* CONNECTION BANNER */}
            <View style={styles.banner}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.bannerTitle}>PC Hub Connection</Text>
                <Text style={styles.bannerSub}>
                  {pendingCount} pending · Sequence {lastSeq}
                </Text>
              </View>

              <Pressable
                style={[styles.syncButton, syncing && { opacity: 0.6 }]}
                onPress={() => syncNow()}
                disabled={syncing}
              >
                {syncing ? (
                  <ActivityIndicator color="#0B1F1D" />
                ) : (
                  <Text style={styles.syncButtonText}>Sync Now</Text>
                )}
              </Pressable>
            </View>

            {/* PC IP ADDRESS */}
            <View style={styles.ipContainer}>
              <View style={styles.ipHeader}>
                <Text style={styles.ipLabel}>HUB IP ADDRESS</Text>
                <View style={styles.autoRow}>
                  <Text style={styles.autoLabel}>Auto-sync</Text>
                  <Switch
                    value={autoSync}
                    onValueChange={setAutoSync}
                    trackColor={{ false: C.border, true: C.tealDark }}
                    thumbColor={autoSync ? C.teal : C.muted}
                  />
                </View>
              </View>

              <View style={styles.ipRow}>
                <TextInput
                  style={[styles.ipInput, { flex: 1 }]}
                  value={pcIp}
                  onChangeText={(text) => {
                    setPcIp(text);
                    pcIpRef.current = text;
                  }}
                  onEndEditing={() => setHubIp(pcIpRef.current.trim())}
                  placeholder="192.168.1.9"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  keyboardType="numeric"
                />

                <Pressable style={styles.scanButton} onPress={openScanner}>
                  <Text style={styles.scanButtonText}>Scan QR</Text>
                </Pressable>
              </View>
            </View>

            {/* RECENTLY DELETED */}
            <Pressable
              style={styles.trashLink}
              onPress={() => setTrashVisible(true)}
            >
              <Text style={styles.trashLinkText}>
                🗑 Recently deleted ({deletedCards.length})
              </Text>
            </Pressable>

            {/* SEARCH */}
            <View style={styles.searchContainer}>
              <Text style={styles.searchIcon}>⌕</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search records, descriptions, locations..."
                placeholderTextColor={C.muted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <Text style={styles.clearSearch}>✕</Text>
                </Pressable>
              )}
            </View>

            {/* SORT */}
            <View style={styles.sortRow}>
              <Text style={styles.sortLabel}>SORT BY</Text>
              {[
                { key: 'newest', label: 'Newest' },
                { key: 'oldest', label: 'Oldest' },
                { key: 'priority', label: 'Priority' },
              ].map((item) => (
                <Pressable
                  key={item.key}
                  onPress={() => setSortMode(item.key)}
                  style={[
                    styles.sortButton,
                    sortMode === item.key && styles.sortButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.sortButtonText,
                      sortMode === item.key && styles.sortButtonTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* FILTER CHIPS */}
            <View style={styles.filterRow}>
              {FILTERS.map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setFilter(item)}
                  style={[
                    styles.filterChip,
                    filter === item && styles.filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      filter === item && styles.filterTextActive,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        data={visibleCards}
        keyExtractor={(item) => item.id}
        renderItem={renderCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={loading}
        onRefresh={refreshCards}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No records found. Add your first record!
          </Text>
        }
      />


      {/* BOTTOM BAR */}

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: Math.max(insets.bottom, 12) + 8,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          {toast !== '' && (
            <View style={styles.toast}>
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          )}
        </View>

        <Pressable style={styles.fab} onPress={openNew}>
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>

      {/* ADD / EDIT RECORD MODAL */}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        navigationBarTranslucent
        statusBarTranslucent
        onRequestClose={() => {
          if (showHistory) {
            setShowHistory(false);
          } else {
            closeEditor();
          }
        }}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalBox}>
            {showHistory ? (
              <>
                {/* VERSION HISTORY VIEW */}

                <Text style={styles.modalTitle}>Version history</Text>

                <ScrollView style={{ maxHeight: 420 }}>
                  {versions.map((v, index) => {
                    let c = {};
                    try {
                      c = JSON.parse(v.content);
                    } catch {}

                    const isDeleted = Number(v.deleted) === 1;

                    return (
                      <View key={v.vid} style={styles.versionRow}>
                        <View style={styles.versionTop}>
                          <Text style={styles.versionTitle}>
                            {index === 0
                              ? 'Current'
                              : 'Version ' + (versions.length - index)}
                          </Text>

                          <Text style={styles.versionMeta}>
                            {formatDate(v.updatedAt)} · {v.deviceId}
                          </Text>
                        </View>

                        {isDeleted ? (
                          <Text style={styles.versionBody}>
                            🗑 Moved to Recently deleted
                          </Text>
                        ) : (
                          <>
                            <Text style={styles.versionText}>{c.title}</Text>
                            <Text style={styles.versionBody}>{c.body}</Text>
                            <Text style={styles.versionMeta}>
                              {c.priority} · {c.status} · 📍 {c.location || '-'}
                            </Text>
                          </>
                        )}

                        {index !== 0 && !isDeleted && (
                          <Pressable onPress={() => handleRestoreVersion(v)}>
                            <Text style={styles.restoreText}>
                              Restore this version
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>

                <Pressable onPress={() => setShowHistory(false)}>
                  <Text style={styles.cancel}>Back</Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* FORM VIEW */}

                <Text style={styles.modalTitle}>
                  {editingId ? 'Edit Record' : 'Create New Record'}
                </Text>

                <Text style={styles.label}>Title *</Text>

                <TextInput
                  style={styles.input}
                  placeholder="Enter record title"
                  placeholderTextColor={C.muted}
                  value={title}
                  onChangeText={setTitle}
                />

                <Text style={styles.label}>Description</Text>

                <TextInput
                  style={[styles.input, styles.descriptionInput]}
                  placeholder="Describe the situation..."
                  placeholderTextColor={C.muted}
                  value={body}
                  onChangeText={setBody}
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.label}>Location</Text>

                <TextInput
                  style={styles.input}
                  placeholder="Enter location"
                  placeholderTextColor={C.muted}
                  value={location}
                  onChangeText={setLocation}
                />

                {/* PRIORITY SELECTION */}

                <Text style={styles.label}>Priority</Text>

                <View style={styles.pickRow}>
                  {PRIORITIES.map((p) => (
                    <Pressable
                      key={p}
                      onPress={() => setPriority(p)}
                      style={[
                        styles.pick,
                        priority === p && {
                          backgroundColor: PRIORITY[p].bg,
                          borderColor: PRIORITY[p].fg,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: priority === p ? PRIORITY[p].fg : C.muted,
                        }}
                      >
                        {p}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* STATUS SELECTION */}

                <Text style={styles.label}>Status</Text>

                <View style={styles.pickRow}>
                  {FILTERS.slice(1).map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => setStatus(s)}
                      style={[
                        styles.pick,
                        status === s && {
                          backgroundColor: STATUS[s].bg,
                          borderColor: STATUS[s].fg,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: status === s ? STATUS[s].fg : C.muted,
                        }}
                      >
                        {s}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* SAVE BUTTON */}

                <Pressable
                  style={styles.saveButton}
                  onPress={handleSaveRecord}
                >
                  <Text style={styles.saveButtonText}>
                    {editingId ? 'Save Changes' : 'Save Record'}
                  </Text>
                </Pressable>

                {editingId && (
                  <Pressable onPress={openHistory}>
                    <Text style={styles.historyLink}>
                      🕘 View version history
                    </Text>
                  </Pressable>
                )}

                {editingId && (
                  <Pressable onPress={handleDelete}>
                    <Text style={styles.deleteText}>
                      Move to Recently deleted
                    </Text>
                  </Pressable>
                )}

                <Pressable onPress={closeEditor}>
                  <Text style={styles.cancel}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* RECENTLY DELETED SCREEN */}

      <Modal
        visible={trashVisible}
        animationType="slide"
        navigationBarTranslucent
        statusBarTranslucent
        onRequestClose={() => setTrashVisible(false)}
      >
        <View style={styles.fullScreen}>
          <View style={styles.sheetHeader}>
            <Text style={styles.modalTitle}>Recently deleted</Text>

            <Pressable onPress={() => setTrashVisible(false)}>
              <Text style={styles.restoreText}>Close</Text>
            </Pressable>
          </View>

          <FlatList
            data={deletedCards}
            keyExtractor={(item) => item.id}
            renderItem={renderDeletedCard}
            contentContainerStyle={{ padding: 16 }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Nothing here</Text>
            }
          />
        </View>
      </Modal>

      {/* QR SCANNER SCREEN */}             

      <Modal
        visible={scanVisible}
        animationType="slide"
        navigationBarTranslucent
        statusBarTranslucent
        onRequestClose={() => setScanVisible(false)}
      >
        <View style={styles.fullScreen}>
          <View style={styles.sheetHeader}>
            <Text style={styles.modalTitle}>Scan hub QR code</Text>

            <Pressable onPress={() => setScanVisible(false)}>
              <Text style={styles.restoreText}>Close</Text>
            </Pressable>
          </View>

          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleScanned}
          />

          <Text style={styles.scanHint}>
            Point at the QR code on the PC dashboard
          </Text>
        </View>
      </Modal>

      {/* SETTINGS SCREEN */}
<Modal
  visible={settingsVisible}
  animationType="slide"
  transparent
  navigationBarTranslucent
  statusBarTranslucent  
  onRequestClose={() => setSettingsVisible(false)}
>
  <View style={styles.modalBackdrop}>
    <View style={styles.modalBox}>
      <Text style={styles.modalTitle}>Settings</Text>
      <View
  style={{
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 20,
  }}
>
  <View>
    <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>
      Appearance
    </Text>
    <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
      {theme === 'dark' ? 'Dark mode' : 'Light mode'}
    </Text>
  </View>

  <Switch
    value={theme === 'dark'}
    onValueChange={toggleTheme}
    trackColor={{ false: C.border, true: C.teal }}
    thumbColor="#FFFFFF"
  />
</View>

{/* HUB CONNECTION */}
<View
  style={{
    marginTop: 12,
    padding: 15,
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  }}
>
  <Text style={{
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  }}>
    PC Hub Connection
  </Text>

  <View style={{
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  }}>
    <Text style={{ color: C.muted, fontSize: 13 }}>
      Connection Status
    </Text>

    <Text style={{
      color: connected ? C.green : C.red,
      fontWeight: '800',
      fontSize: 13,
    }}>
      {connected ? '● Connected' : '● Disconnected'}
    </Text>
  </View>

  <View style={{
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  }}>
    <Text style={{ color: C.muted, fontSize: 13 }}>
      PC Hub IP
    </Text>
    <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
      {pcIp}
    </Text>
  </View>
</View>

{/* ABOUT SYNCNEST */}
<View
  style={{
    marginTop: 18,
    padding: 15,
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  }}
>
  <Text style={{
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  }}>
    About SyncNest
  </Text>

  <View style={{
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  }}>
    <Text style={{ color: C.muted, fontSize: 13 }}>App Name</Text>
    <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
      SyncNest
    </Text>
  </View>

  <View style={{
    flexDirection: 'row',
    justifyContent: 'space-between',
  }}>
    <Text style={{ color: C.muted, fontSize: 13 }}>Version</Text>
    <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
      2.0.0
    </Text>
  </View>
</View>

      <Text style={styles.label}>Device Name</Text>

      <TextInput
        style={styles.input}
        value={deviceNameInput}
        onChangeText={setDeviceNameInput}
        placeholder="Enter device name"
        placeholderTextColor={C.muted}
        maxLength={30}
      />

      <Pressable
        style={styles.saveButton}
        onPress={async () => {
          try {
            await setDeviceName(deviceNameInput);
            await registerDeviceWithHub(deviceNameInput.trim());
            setDeviceNameState(deviceNameInput.trim());
            setSettingsVisible(false);
            showToast('Device name updated');
          } catch (error) {
            Alert.alert('Invalid name', error.message);
          }
        }}
      >
        <Text style={styles.saveButtonText}>Save Device Name</Text>
      </Pressable>

      <Pressable onPress={() => setSettingsVisible(false)}>
        <Text style={styles.cancel}>Close</Text>
      </Pressable>
    </View>
  </View>
</Modal>
    </KeyboardAvoidingView>
  );
}



// ---------------- STYLES ----------------

function createStyles(C) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: 16,
  },

  loadingScreen: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },

  loadingText: {
    color: C.muted,
    marginTop: 14,
    fontSize: 15,
  },


  // HEADER

  headerRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingHorizontal: 20,
  paddingVertical: 5,
  marginBottom: 4,
},

  title: {
  fontSize: 27,
  fontWeight: '900',
  color: C.text,
  flexShrink: 1,
},
  subtitle: {
  color: C.muted,
  fontSize: 11,
  marginTop: 5,
  letterSpacing: 0.2,
  paddingRight: 4,
},

  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
  },

  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },



  // CONNECTION BANNER

  banner: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: C.tealDark,
  borderWidth: 1,
  borderColor: C.border,
  borderRadius: 18,
  padding: 16,
  marginHorizontal: 18,
  marginTop: 20,
},

  bannerTitle: {
    color: C.text,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.2,
  },

  bannerSub: {
    color: C.muted,
    fontSize: 12,
    marginTop: 6,
  },

  syncButton: {
    backgroundColor: C.teal,
    borderRadius: 13,
    paddingHorizontal: 17,
    paddingVertical: 13,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },

  syncButtonText: {
    color: '#0B1F1D',
    fontWeight: '800',
    fontSize: 13,
  },


  // IP ADDRESS

  ipContainer: {
    marginHorizontal: 18,
    marginTop: 8,
    padding: 14,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
  },

  ipLabel: {
    color: C.muted,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 5,
    letterSpacing: 1.2,
  },

  ipInput: {
    backgroundColor: C.bg,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14,
  },

  // RECENTLY DELETED LINK

  trashLink: {
    alignSelf: 'flex-end',
    marginRight: 18,
    marginTop: 4,
  },

  trashLinkText: {
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
  },


  // SEARCH

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    marginHorizontal: 18,
    marginTop: 10,
    paddingHorizontal: 14,
    height: 50,
  },

  searchIcon: {
    color: C.teal,
    fontSize: 25,
    marginRight: 10,
  },

  searchInput: {
    flex: 1,
    color: C.text,
    fontSize: 13,
    paddingVertical: 8,
  },

  clearSearch: {
    color: C.muted,
    fontSize: 17,
    padding: 5,
  },

  // SORT
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    marginTop: 8,
    marginBottom: 6,
    gap: 8,
  },
  sortLabel: {
    color: C.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginRight: 3,
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  sortButtonActive: {
    backgroundColor: C.tealDark,
    borderColor: C.teal,
  },
  sortButtonText: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  sortButtonTextActive: {
    color: C.teal,
    fontWeight: '800',
  },

  // FILTERS

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },

  filterChip: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },

  filterChipActive: {
    backgroundColor: C.tealDark,
    borderColor: C.teal,
  },

  filterText: {
    color: '#C5C9D3',
    fontWeight: '500',
    fontSize: 13,
  },

  filterTextActive: {
    color: C.teal,
    fontWeight: '700',
  },


  // CARDS

  listContent: {
  paddingHorizontal: 18,
  paddingTop: 8,
  paddingBottom: 110,
  flexGrow: 1,
},

  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: '#303640',
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },

  cardBeingEdited: {
  borderWidth: 1.5,
  borderColor: C.teal,
  borderStyle: 'dotted',
  shadowColor: C.teal,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.45,
  shadowRadius: 10,
  elevation: 6,
},

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  cardTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '800',
    flex: 1,
    letterSpacing: 0.2,
  },

  cardTime: {
    color: C.muted,
    fontSize: 11,
    marginLeft: 10,
  },

  cardBody: {
    color: '#B5BBC5',
    marginTop: 10,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 21,
  },

  cardLocation: {
    color: C.muted,
    fontSize: 12,
    marginBottom: 15,
  },

  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#303640',
    paddingTop: 12,
  },

  tags: {
    flexDirection: 'row',
    gap: 7,
    flexWrap: 'wrap',
    flex: 1,
  },

  tag: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    fontWeight: '700',
    fontSize: 10,
    overflow: 'hidden',
  },

  syncLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
  },

  // BOTTOM BAR

  bottomBar: {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-end',
  paddingHorizontal: 20,
  paddingTop: 8,
  backgroundColor: 'transparent',
  zIndex: 10,
  elevation: 10,
},

  toast: {
    backgroundColor: '#173A3A',
    borderWidth: 1,
    borderColor: C.teal,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },

  toastText: {
    color: '#CFF5EF',
    fontWeight: '600',
    fontSize: 12,
  },

  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fabText: {
    fontSize: 32,
    color: '#0B1F1D',
    marginTop: -3,
  },

  // MODAL

  modalBackdrop: {
  flex: 1,
  backgroundColor: C.bg === DARK_COLORS.bg
    ? 'rgba(0,0,0,0.7)'
    : 'rgba(20,35,40,0.35)',
  justifyContent: 'flex-end',
},

  modalBox: {
  padding: 20,
  paddingBottom: 30,
  borderTopLeftRadius: 22,
  borderTopRightRadius: 22,
  backgroundColor: C.card,
  borderColor: C.border,
  borderWidth: 1,
},

  modalTitle: {
    color: C.text,
    fontSize: 21,
    fontWeight: 'bold',
    marginBottom: 18,
  },

  label: {
    color: C.muted,
    fontSize: 13,
    marginBottom: 7,
    marginTop: 5,
    fontWeight: '600',
  },

  input: {
    backgroundColor: C.bg,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 11,
    padding: 12,
    marginBottom: 10,
    fontSize: 14,
  },

  descriptionInput: {
    height: 75,
  },

  pickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  pick: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  saveButton: {
    backgroundColor: C.teal,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },

  saveButtonText: {
    color: '#0B1F1D',
    fontWeight: '800',
    fontSize: 15,
  },

  historyLink: {
    textAlign: 'center',
    color: C.teal,
    marginTop: 16,
    fontSize: 14,
    fontWeight: '600',
  },

  deleteText: {
    textAlign: 'center',
    color: C.red,
    marginTop: 14,
    fontSize: 14,
    fontWeight: '600',
  },

  cancel: {
    textAlign: 'center',
    color: C.muted,
    marginTop: 16,
    fontSize: 14,
  },

  // RECENTLY DELETED SCREEN

  fullScreen: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: 54,
  },

  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  restoreText: {
    color: C.teal,
    fontWeight: '700',
    fontSize: 13,
    marginTop: 8,
  },

  // VERSION HISTORY

  versionRow: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },

  versionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },

  versionTitle: {
    color: C.teal,
    fontWeight: '700',
    fontSize: 13,
  },

  versionMeta: {
    color: C.muted,
    fontSize: 11,
  },

  versionText: {
    color: C.text,
    fontWeight: '700',
    fontSize: 15,
  },

  versionBody: {
    color: C.muted,
    fontSize: 13,
    marginVertical: 4,
  },

  // AUTO SYNC

  ipHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
},
autoRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
},
autoLabel: {
  color: C.muted,
  fontSize: 11,
  fontWeight: '700',
},

// QR Scanner
ipRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
scanButton: {
  backgroundColor: C.tealDark,
  borderWidth: 1,
  borderColor: C.teal,
  borderRadius: 10,
  paddingHorizontal: 14,
  paddingVertical: 10,
},
scanButtonText: { color: C.teal, fontWeight: '700', fontSize: 13 },
camera: { flex: 1, margin: 16, borderRadius: 16, overflow: 'hidden' },
scanHint: { color: C.muted, textAlign: 'center', paddingBottom: 30 },

headerActions: {
  flexDirection: 'row',
  alignItems: 'center',
  flexShrink: 0,
  gap: 8,
},

themeButton: {
  width: 40,
  height: 40,
  borderRadius: 14,
  backgroundColor: C.card,
  borderWidth: 1,
  borderColor: C.border,
  alignItems: 'center',
  justifyContent: 'center',
},

themeButtonText: {
  color: C.teal,
  fontSize: 20,
  fontWeight: '700',
},
});
}