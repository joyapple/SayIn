# SayIn

> Turn your phone into your computer's input method.

No microphone on your Mac Mini? Typing on the computer inconvenient? Use your phone's familiar input method (keyboard / voice) to write content, tap once, and it's sent to the computer. Zero install on the phone—just open in a browser.

**License: Apache-2.0**

## Index

- **English version (this file)**: [README.en.md](./README.en.md)
- **中文版**: [README.md](./README.md)

### Table of Contents

- [Why I Built This](#why-i-built-this)
- [What It Solves](#what-it-solves)
- [Small and Beautiful, Not Bloated](#small-and-beautiful-not-bloated)
- [Feature Overview](#feature-overview)
- [Quick Start](#quick-start)
- [PWA Installation](#pwa-installation-recommended)
- [Settings Page](#settings-page)
- [macOS Permission Setup](#macos-permission-setup)
- [Cross-Computer Deployment / Auto Certificate Generation](#cross-computer-deployment--auto-certificate-generation)
- [Project Structure](#project-structure)
- [Technical Architecture](#technical-architecture)
- [FAQ](#faq)
- [License](#license)

---

## Why I Built This

This is not a commercial product. It's a small tool a developer built to solve his own pain point.

> I have a Mac Mini. Powerful machine, but it has no microphone and no camera. To use voice input, or to send a quick message to a colleague, I either had to plug in an external mic, or type on my phone and copy-paste back and forth—too much hassle.

So SayIn was born: the phone is the input pad, the computer is the receiver. The phone doesn't need any app—just open it in a browser. Type or use voice, tap "Send", and the text appears at the computer's cursor. That's it. My Mac Mini finally has a "voice".

| | |
|:---:|:---:|
| **0** | Apps to install on the phone |
| **1** | npm command to start |
| **2** | devices (phone + computer) |

---

## What It Solves

If you've ever run into these scenarios, SayIn can probably help.

### Desktop without a microphone

Mac Mini, custom-built PCs, monitors without built-in mics—voice input used to require external hardware. SayIn turns your phone into the mic and input pad.

### Type on phone, then copy-paste

Writing a long message on your phone, then manually copying, switching to the computer, pasting—too many steps, easy to lose content. SayIn: one tap on "Send" and it lands directly.

### Cross-device text transfer is tedious

Getting text from phone to computer usually means a detour: send to "File Transfer Assistant", paste into cloud notes, or email yourself. SayIn only transfers text over a direct LAN WebSocket connection—in real time, no middlemen.

### System voice input is clunky

macOS Dictation needs internet, is slow to recognize, and requires hotkeys. SayIn uses the input method you already know on your phone—type however you like.

### Long-form typing is tiring

A few hundred words on a computer keyboard is fine, but a thousand plus gets exhausting. Use your phone's familiar input method—write lying down, walking around, and tap "Send" when done.

### External mics are expensive and not portable

A decent USB mic costs hundreds, and you won't carry it everywhere. Your phone is already in your hand all day—it's the most natural input device you own.

---

## Small and Beautiful, Not Bloated

No accounts, no cloud, no subscriptions. One Node.js file runs it all, and the data stays on your own computer.

- **Zero install on phone** — No app to download, no plugin to install. Just open a URL in the phone browser, with support for "Add to Home Screen" for a full-screen, app-like experience.
- **Pure LAN, data never leaves** — Phone and computer connect directly over the same WiFi, text streams via WebSocket, never through any third-party server.
- **One command to start** — `npm start` and you're running. The only dependency is a WebSocket library, so it's small, fast, and light on resources.
- **Cross-platform** — Supports macOS and Windows. macOS can auto-paste at the cursor; on Windows, manual copy-paste works.

```
Phone                         Computer
 │                            │
 │  WebSocket direct over LAN │
 │  ──────────────────────────►│
 │  phone IME type/voice → Send │  text appears at cursor
```

---

## Feature Overview

Built around the full "input → transfer → landing" pipeline, with details polished enough for daily use.

| Feature | Description |
|---------|-------------|
| **Phone input, computer receives** | Type or use voice recognition on your phone, tap send and the text appears in real time on the computer's receiver window |
| **App switching** | One-tap list of running apps on the computer, switch and auto-paste into the target app |
| **Auto-paste** | After sending, automatically paste at the computer's cursor (macOS requires Accessibility permission) |
| **Enter to send** | After pasting, simulate Enter to send—works with WeChat, QQ, and other apps that need Enter to send |
| **Append mode** | New content appends to the end of the input box instead of overwriting—great for writing long content in segments |
| **History** | Sent records are persisted, with one-tap resend—no fear of accidental deletion |
| **App whitelist** | Filter your frequently used apps in settings, so the running-apps list isn't too long |
| **PWA support** | Add to phone home screen, use full-screen like a native app, no address bar |
| **Persisted settings** | All settings are auto-saved, surviving service restarts |

---

## Quick Start

### Requirements

- [Node.js](https://nodejs.org/) 18+
- Phone and computer on the same LAN (same WiFi)

### Install and Run

```bash
git clone https://github.com/joyapple/SayIn.git
cd SayIn
npm install
npm start
```

After startup, the access URLs are printed:

```
╔══════════════════════════════════════════════════════════════════╗
║                       ✦  SayIn  Started  ✦                      ║
║                  Phone pad → Computer · Elegant input            ║
╠══════════════════════════════════════════════════════════════════╣
║  💻 Computer receiver:  http://localhost:8000/desk               ║
║  ⚙️  Settings:          http://localhost:8000/settings           ║
║  📱 Phone entry:        http://192.168.x.x:8000                  ║
║  🔒 Phone (HTTPS):      https://192.168.x.x:8443                 ║
╚══════════════════════════════════════════════════════════════════╝
```

### Usage Steps

1. **Computer**: open `http://localhost:8000/desk` in a browser to receive text
2. **Phone**: open `https://COMPUTER_IP:8443` in a mobile browser (HTTPS recommended)
3. **Send**: type or use voice on your phone, tap "Send"
4. **Switch apps**: tap the app bar at the top to pick a target app on the computer

---

## PWA Installation (Recommended)

For a native-app-like full-screen experience (no address bar), access via **HTTPS** and add to your home screen.

### Android (Chrome / Edge)

1. Open `https://COMPUTER_IP:8443` in your phone browser
2. On first access, trust the self-signed certificate ("Advanced" → "Proceed")
3. The page will show an "Install SayIn" prompt—tap "Install"
4. Open from the home screen for full-screen use, no address bar

### iOS (Safari)

1. Open `https://COMPUTER_IP:8443` in Safari
2. On first access, trust the self-signed certificate
3. Tap "Share" at the bottom → "Add to Home Screen"
4. Open from the home screen for full-screen use

> **Note**: Adding to home screen via HTTP (port 8000) will keep the address bar. You must use HTTPS (port 8443) for the full-screen PWA experience.

---

## Settings Page

Open `http://localhost:8000/settings` to configure:

| Setting | Description |
|---------|-------------|
| Auto-paste | After sending, automatically paste at the computer's cursor (requires Accessibility permission) |
| Append mode | New content appends to the end of the input box, instead of overwriting |
| Enter after paste | After auto-paste, simulate Enter for apps that need Enter to send |
| App whitelist | Filter switchable apps; leave empty to show all running apps |
| Language | Switch UI between 中文 / English |

All settings are persisted to `data/settings.json` and survive restarts.

---

## macOS Permission Setup

### Accessibility Permission (required for auto-paste)

If you enable the "Auto-paste" feature, you need to grant Accessibility permission:

1. Open **System Settings → Privacy & Security → Accessibility**
2. Add the terminal app running SayIn (e.g. "Terminal", "iTerm") and check it on

### Trusting the Self-Signed Certificate (for HTTPS access)

On first HTTPS access, the browser will warn that the certificate is not trusted:

- **Android Chrome**: "Advanced" → "Proceed"
- **iOS Safari**: "Show Details" → "Visit this website"
- **macOS**: double-click `certs/cert.pem` to import into Keychain and set as "Always Trust"

---

## Cross-Computer Deployment / Auto Certificate Generation

The certificate is fully auto-generated—**no manual configuration needed**.

### How it works

1. On startup, the server checks whether `certs/cert.pem` and `certs/key.pem` exist
2. **Missing** (first run) → auto-generates a self-signed certificate, with all of the current computer's LAN IPs included in the SAN
3. **Exists** → reused, not regenerated

### Three deployment scenarios

**Scenario 1: `git clone` on a new computer (recommended)**

- `certs/` is in `.gitignore`, so a fresh clone has no certificate
- First `npm start` auto-generates one, with the IP matching the new computer
- **Zero config**

**Scenario 2: Copying the entire project directory (including `certs/`) to a new computer**

- The old certificate is reused
- But the SAN in the old cert lists the old computer's IPs, so when the new computer's IP differs, the browser shows a "certificate mismatch" warning (still works—just manually trust it—but the warning shows every time)
- **Recommended**: delete the `certs/` directory and let it regenerate on startup

**Scenario 3: Windows computer**

- Windows doesn't ship with openssl by default
- The program automatically falls back to the Node.js built-in `crypto` module to generate the certificate, with no dependency on system openssl
- **Works too**, also zero-config

### Certificate compatibility details

- Tries three paths in order: `/opt/homebrew/bin/openssl` (Apple Silicon), `/usr/local/bin/openssl` (Intel Mac), `openssl` (PATH)
- Uses the `-config` full-config-file approach, compatible with both macOS built-in LibreSSL and brew-installed OpenSSL
- In the SAN, `localhost` uses the `DNS:` prefix and real IPs use the `IP:` prefix, per RFC 5280

---

## Project Structure

```
SayIn/
├── server.js              # Backend (HTTP/HTTPS + WebSocket + static files)
├── package.json
├── public/                # Frontend pages
│   ├── index.html         # Phone (input + send + history + app switcher)
│   ├── desk.html          # Computer receiver window
│   ├── settings.html      # Computer settings page
│   ├── landing.html       # Landing page
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service Worker (offline cache)
│   └── app-icon.svg       # App icon
├── data/                  # Persisted data
│   ├── settings.json      # User settings
│   └── history.json       # Send history
├── certs/                 # Self-signed cert (auto-generated, .gitignore'd)
│   ├── cert.pem
│   └── key.pem
├── LICENSE
├── README.md              # Chinese readme
└── README.en.md           # English readme (this file)
```

## Technical Architecture

```
Phone browser                 Computer browser
   │                            │
   │  WebSocket (text transfer) │  WebSocket (text receive)
   │                            │
   └─────────► server.js ◄──────┘
                  │
                  ├── HTTP  (8000) — phone entry + computer pages
                  ├── HTTPS (8443) — PWA full-screen mode
                  ├── Static file serving
                  ├── App list (lsappinfo + ps)
                  ├── Auto-paste (osascript keystroke)
                  └── Settings/history persistence
```

- **Transport**: WebSocket real-time bidirectional transfer, pure LAN, no third-party server
- **App list**: `lsappinfo` (display names) + `ps` (fallback), zero permissions
- **App switching**: `open -a` (zero permissions) + `osascript` (fallback)
- **Auto-paste**: `pbcopy` writes clipboard + `osascript` simulates Cmd+V
- **PWA**: manifest.json + Service Worker offline cache
- **Certificate generation**: openssl `-config` approach (LibreSSL/OpenSSL compatible) + Node.js crypto fallback

---

## FAQ

### Phone can't open the page?

- Confirm phone and computer are on the same WiFi
- Confirm the computer's firewall isn't blocking ports 8000/8443
- Try HTTPS (port 8443)

### Nothing shows on the computer after sending?

- Refresh the computer page at `http://localhost:8000/desk`
- Confirm the page shows "Connected"

### Auto-paste fails?

- On macOS, grant Accessibility permission to the terminal app in **System Settings → Privacy & Security → Accessibility**
- Windows doesn't currently support auto-paste—use manual copy-paste

### PWA still shows the address bar?

- You must add to home screen via **HTTPS** (port 8443)
- Adding via HTTP (port 8000) keeps the address bar
- On iOS use Safari, on Android use Chrome/Edge

### Running apps aren't detected?

- Click "Load running apps" on the settings page to refresh the list
- Built-in system apps (Finder, Control Center, etc.) are filtered out automatically
- Manually add a whitelist for your frequently used apps

### Certificate error after switching computers?

- Don't copy the old computer's `certs/` directory to the new computer
- Delete the `certs/` directory and re-run `npm start`—a new certificate will be auto-generated
- The new certificate's SAN will automatically match the new computer's IP

---

## License

Apache-2.0 © [JOYAPPLE](https://github.com/joyapple)
