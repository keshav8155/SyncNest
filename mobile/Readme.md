# SyncNest

**A simple, local-first record management app that keeps multiple devices in sync.**

SyncNest is built with React Native and Expo, using SQLite for local storage and an Express.js PC Hub for synchronization over a local network.

## Features

- Create, edit, view, and delete records.
- Local data storage using SQLite.
- Synchronization between devices through a PC Hub.
- Record version history and restore previous versions.
- Live editing indicators showing which device is editing a record.
- Permanent device registration and customizable device names.
- Search and sort records.
- Light and dark themes with saved preferences.
- Settings for device name, appearance, and Hub connection.
- Clean, modern interface with floating action button and safe-area support.
- QR code support for connecting to the PC Hub.

## Tech Stack

- React Native and Expo
- JavaScript
- SQLite
- Node.js and Express.js
- JSON-based Hub storage

## Getting Started

**Start the PC Hub:**

```bash
node server.js
```

**Start the mobile app:**

```bash
npm install
npx expo start
```

Connect your mobile device and PC to the same local network, then connect the app to the PC Hub.

---

**SyncNest — Your records, connected.**