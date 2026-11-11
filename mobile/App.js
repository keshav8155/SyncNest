import { useEffect, useState, useRef } from 'react';
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

import { StatusBar } from 'expo-status-bar';

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
} from './db';

// ---------------- CONFIGURATION ----------------

const DEFAULT_PC_IP = '192.168.1.8';
const SERVER_PORT = 3000;

const C = {
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
  const [cards, setCards] = useState([]);
  const [deviceId, setDeviceId] = useState('Loading...');
  const [lastSeq, setLastSeq] = useState(0);

  const [autoSync, setAutoSync] = useState(true);
  const syncingRef = useRef(false);
  const pcIpRef = useRef(DEFAULT_PC_IP);
  const syncNowRef = useRef(null);

  const [pcIp, setPcIp] = useState(DEFAULT_PC_IP);
  const [filter, setFilter] = useState('All');

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [trashVisible, setTrashVisible] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [toast, setToast] = useState('');

  // Form fields
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState('Medium');
  const [status, setStatus] = useState('To do');

  // ---------------- DATABASE INITIALIZATION ----------------

  useEffect(() => {
    let mounted = true;

    async function startApp() {
      try {
        const id = await initDb();

        const records = await getAllRecords();
        const seq = await getLastSeq();

        if (mounted) {
          setDeviceId(id);
          setCards(records);
          setLastSeq(seq);
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
    setShowHistory(false);
    setModalVisible(false);
    setEditingId(null);

    showToast(
      changed ? 'Version restored · Pending sync' : 'Already the current content'
    );
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
    const currentSeq = await getLastSeq();

    const response = await fetch(
      `http://${pcIpRef.current.trim()}:${SERVER_PORT}/sync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: getDeviceId(),
          lastSeq: currentSeq,
          changes,
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

  // ---------------- FILTER RECORDS ----------------

  const activeCards = cards.filter(
    (record) => Number(record.deleted) === 0
  );

  const deletedCards = cards.filter(
    (record) => Number(record.deleted) === 1
  );

  const visibleCards =
    filter === 'All'
      ? activeCards
      : activeCards.filter((record) => {
          try {
            const content = JSON.parse(record.content);
            return content.status === filter;
          } catch {
            return false;
          }
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

    return (
      <Pressable style={styles.card} onPress={() => openEdit(item)}>
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

          <Text
            style={[
              styles.syncLabel,
              { color: isPending ? C.amber : C.green },
            ]}
          >
            {isPending ? '◷ Pending' : '✓ Synced'}
          </Text>
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="light" />

      {/* HEADER */}

      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>SyncNest</Text>

          <Text style={styles.subtitle}>
            Field Operations · {deviceId}
          </Text>
        </View>

        <View
          style={[
            styles.connectionBadge,
            {
              backgroundColor: connected ? '#173A2B' : '#352C1C',
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
              color: connected ? C.green : C.amber,
              fontWeight: '700',
              fontSize: 12,
            }}
          >
            {connected ? 'Connected' : 'Local'}
          </Text>
        </View>
      </View>

      {/* CONNECTION BANNER */}

      <View style={styles.banner}>
        <View style={{ flex: 1 }}>
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

        <TextInput
          style={styles.ipInput}
          value={pcIp}
          onChangeText={(text) => {
            setPcIp(text);
            pcIpRef.current = text;
          }}
          placeholder="192.168.1.9"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          keyboardType="numeric"
        />
      </View>

      {/* RECENTLY DELETED LINK */}

      <Pressable
        style={styles.trashLink}
        onPress={() => setTrashVisible(true)}
      >
        <Text style={styles.trashLinkText}>
          🗑 Recently deleted ({deletedCards.length})
        </Text>
      </Pressable>

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

      {/* CARD LIST */}

      <FlatList
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

      <View style={styles.bottomBar}>
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
        onRequestClose={() => {
          if (showHistory) {
            setShowHistory(false);
          } else {
            setModalVisible(false);
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

                <Pressable onPress={() => setModalVisible(false)}>
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
    </KeyboardAvoidingView>
  );
}

// ---------------- STYLES ----------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    paddingTop: 54,
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
  },

  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: C.text,
  },

  subtitle: {
    color: C.muted,
    fontSize: 12,
    marginTop: 4,
  },

  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    gap: 7,
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
    backgroundColor: '#1B1E25',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 20,
  },

  bannerTitle: {
    color: C.text,
    fontWeight: '700',
    fontSize: 14,
  },

  bannerSub: {
    color: C.muted,
    fontSize: 12,
    marginTop: 5,
  },

  syncButton: {
    backgroundColor: C.teal,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 95,
    alignItems: 'center',
  },

  syncButtonText: {
    color: '#0B1F1D',
    fontWeight: '700',
  },

  // IP ADDRESS

  ipContainer: {
    marginHorizontal: 18,
    marginTop: 14,
  },

  ipLabel: {
    color: C.muted,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 5,
    letterSpacing: 1,
  },

  ipInput: {
    backgroundColor: C.card,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },

  // RECENTLY DELETED LINK

  trashLink: {
    alignSelf: 'flex-end',
    marginRight: 18,
    marginTop: 12,
  },

  trashLinkText: {
    color: C.muted,
    fontSize: 12,
    fontWeight: '600',
  },

  // FILTERS

  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginVertical: 16,
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
    paddingHorizontal: 16,
    paddingBottom: 20,
    flexGrow: 1,
  },

  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  cardTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },

  cardTime: {
    color: C.muted,
    fontSize: 11,
    marginLeft: 8,
  },

  cardBody: {
    color: C.muted,
    marginTop: 8,
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 21,
  },

  cardLocation: {
    color: C.muted,
    fontSize: 12,
    marginBottom: 12,
  },

  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  tags: {
    flexDirection: 'row',
    gap: 7,
    flexWrap: 'wrap',
    flex: 1,
  },

  tag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    fontWeight: '700',
    fontSize: 11,
    overflow: 'hidden',
  },

  syncLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },

  emptyText: {
    color: C.muted,
    textAlign: 'center',
    marginTop: 50,
    fontSize: 14,
  },

  // BOTTOM BAR

  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 28,
    backgroundColor: C.bg,
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },

  modalBox: {
    backgroundColor: '#1B1E25',
    padding: 20,
    paddingBottom: 30,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
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
});