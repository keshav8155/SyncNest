import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Modal,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { StatusBar } from 'expo-status-bar';

import {
  initDb,
  getDeviceId,
  getLastSeq,
  getAllRecords,
  getPendingRecords,
  saveRecordLocally,
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

// ---------------- MAIN APP ----------------

export default function App() {
  const [cards, setCards] = useState([]);
  const [deviceId, setDeviceId] = useState('Loading...');
  const [lastSeq, setLastSeq] = useState(0);

  const [pcIp, setPcIp] = useState(DEFAULT_PC_IP);
  const [filter, setFilter] = useState('All');

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connected, setConnected] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
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

  // ---------------- ADD NEW RECORD ----------------

  async function handleSaveRecord() {
    if (!title.trim()) {
      Alert.alert('Missing title', 'Please enter a record title.');
      return;
    }

    try {
      await saveRecordLocally(
        title.trim(),
        body.trim(),
        priority,
        location.trim(),
        status
      );

      await refreshCards();

      setTitle('');
      setBody('');
      setLocation('');
      setPriority('Medium');
      setStatus('To do');

      setModalVisible(false);

      showToast('Record saved · Pending sync');
    } catch (error) {
      console.log('Save error:', error);
      Alert.alert('Error', 'Could not save the record.');
    }
  }

  // ---------------- SYNC WITH PC HUB ----------------

  async function syncNow() {
    if (syncing) return;

    setSyncing(true);

    try {
      const changes = await getPendingRecords();
      const currentSeq = await getLastSeq();

      const response = await fetch(
        `http://${pcIp.trim()}:${SERVER_PORT}/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId: getDeviceId(),
            lastSeq: currentSeq,
            changes,
          }),
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

      // Mark uploaded records as synced.
      const uploadedIds = changes.map((record) => record.id);

      await markSynced(uploadedIds);

      // Apply records received from the PC Hub.
      await applyServerResponse(
        result.newSeq,
        result.changes
      );

      await refreshCards();

      setConnected(true);

      showToast(
        changes.length > 0
          ? `Sync complete · ${changes.length} uploaded`
          : 'Sync complete · Up to date'
      );
    } catch (error) {
      console.log('Sync error:', error);
      setConnected(false);

      Alert.alert(
        'Sync Failed',
        'Could not connect to the PC Hub. Check the IP address, Wi-Fi and server status.'
      );
    } finally {
      setSyncing(false);
    }
  }

  // ---------------- FILTER RECORDS ----------------

  const activeCards = cards.filter(
    (record) => Number(record.deleted) === 0
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

  const pendingCount = activeCards.filter(
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
      <View style={styles.card}>
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
      </View>
    );
  }

  // ---------------- MAIN SCREEN ----------------

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
              backgroundColor: connected
                ? '#173A2B'
                : '#352C1C',
            },
          ]}
        >
          <View
            style={[
              styles.connectionDot,
              {
                backgroundColor: connected
                  ? C.green
                  : C.amber,
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
          <Text style={styles.bannerTitle}>
            PC Hub Connection
          </Text>

          <Text style={styles.bannerSub}>
            {pendingCount} pending · Sequence {lastSeq}
          </Text>
        </View>

        <Pressable
          style={[
            styles.syncButton,
            syncing && { opacity: 0.6 },
          ]}
          onPress={syncNow}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator color="#0B1F1D" />
          ) : (
            <Text style={styles.syncButtonText}>
              Sync Now
            </Text>
          )}
        </Pressable>
      </View>

      {/* PC IP ADDRESS */}

      <View style={styles.ipContainer}>
        <Text style={styles.ipLabel}>HUB IP ADDRESS</Text>

        <TextInput
          style={styles.ipInput}
          value={pcIp}
          onChangeText={setPcIp}
          placeholder="192.168.1.9"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          keyboardType="numeric"
        />
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
              <Text style={styles.toastText}>
                {toast}
              </Text>
            </View>
          )}
        </View>

        <Pressable
          style={styles.fab}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      </View>

      {/* ADD RECORD MODAL */}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>
              Create New Record
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
                      color:
                        priority === p
                          ? PRIORITY[p].fg
                          : C.muted,
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
                      color:
                        status === s
                          ? STATUS[s].fg
                          : C.muted,
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
                Save Record
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.cancel}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
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

  cancel: {
    textAlign: 'center',
    color: C.muted,
    marginTop: 16,
    fontSize: 14,
  },
});