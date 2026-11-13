
import { useEffect, useState } from 'react';

const SERVER_PORT = 3000;

export default function useLivePresence({
  hubIp,
  deviceId,
  deviceName,
  editingRecordId,
  enabled = true,
}) {
  const [presence, setPresence] = useState([]);

  const baseUrl = `http://${hubIp}:${SERVER_PORT}`;

  // Check which devices are editing records
  useEffect(() => {
    if (!enabled || !hubIp) return;

    let active = true;

    async function fetchPresence() {
      try {
        const response = await fetch(`${baseUrl}/presence`);

        if (!response.ok) return;

        const data = await response.json();

        if (active) {
          setPresence(data);
        }
      } catch {
        // Presence is optional. Offline mode should continue working.
      }
    }

    fetchPresence();

    const interval = setInterval(fetchPresence, 2500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [hubIp, enabled]);

  // Tell the server when this device is editing
  useEffect(() => {
    if (!enabled || !hubIp || !deviceId || !editingRecordId) {
      return;
    }

    let active = true;

    async function sendHeartbeat() {
      try {
        await fetch(`${baseUrl}/presence`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            deviceId,
            deviceName,
            recordId: editingRecordId,
            editing: true,
          }),
        });
      } catch {
        // Server unavailable; the presence timeout handles stale entries.
      }
    }

    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, 4000);

    return () => {
      active = false;
      clearInterval(interval);

      // Best-effort removal when the editor closes.
      fetch(`${baseUrl}/presence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          deviceName,
          recordId: editingRecordId,
          editing: false,
        }),
      }).catch(() => {});
    };
  }, [
    hubIp,
    deviceId,
    deviceName,
    editingRecordId,
    enabled,
  ]);

  return presence;
}
