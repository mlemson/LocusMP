# 🎮 LOCUS Multiplayer — Firebase Setup Gids

Stap voor stap instructies om jouw Locus Multiplayer op te zetten.

---

## 📋 Wat je nodig hebt

1. Een Google account  
2. Node.js (v20+) geïnstalleerd — [download](https://nodejs.org)
3. Firebase CLI

---

## Stap 1: Firebase Project Aanmaken

1. Ga naar [Firebase Console](https://console.firebase.google.com/)
2. Klik **"Project toevoegen"**
3. Noem het bijv. `locus-multiplayer`
4. Google Analytics mag uit (niet nodig)
5. Klik **"Project aanmaken"**

---

## Stap 2: Firebase CLI Installeren

Open een terminal en voer uit:

```bash
npm install -g firebase-tools
firebase login
```

---

## Stap 3: Web App Registreren

1. In Firebase Console → klik op het **web-icoon** `</>` (linksboven)
2. Geef je app een naam (bijv. `locus-mp-web`)
3. **Kopieer de firebaseConfig** die verschijnt
4. Open `multiplayer.html` en plak jouw config in het `FIREBASE_CONFIG` object:

```javascript
const FIREBASE_CONFIG = {
    apiKey: "AIza...",
    authDomain: "locus-multiplayer.firebaseapp.com",
    projectId: "locus-multiplayer",
    storageBucket: "locus-multiplayer.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
};
```

---

## Stap 4: Firestore Database Inschakelen

1. Firebase Console → **Build** → **Firestore Database**
2. Klik **"Database aanmaken"**
3. Kies **"Productie modus"** (we hebben Firestore Rules)
4. Kies een regio dicht bij jou (bijv. `europe-west1`)

---

## Stap 5: Authentication Inschakelen

1. Firebase Console → **Build** → **Authentication**
2. Klik **"Aan de slag"**
3. Tab → **Sign-in method**
4. Schakel **"Anoniem"** in → Klik **"Inschakelen"** → **"Opslaan"**

---

## Stap 6: Firebase Project Initialiseren (lokaal)

In je project map (`Locus -MP`), run:

```bash
firebase init
```

Kies:
- ✅ Firestore
- ✅ Functions  
- ✅ Hosting (optioneel, voor deployment)

Bij vragen:
- **Welk project?** → Selecteer je `locus-multiplayer` project
- **Firestore Rules bestand?** → `firestore.rules` (al aangemaakt)
- **Functions taal?** → JavaScript
- **ESLint?** → Nee (optioneel)
- **Functions directory?** → `backend`
- **Install dependencies?** → Ja

---

## Stap 7: Shared Game Rules Beschikbaar Maken voor Functions

De backend heeft `shared/game-rules.js` nodig. Kopieer het of maak een symlink:

```bash
# Windows (PowerShell, als Administrator):
Copy-Item -Path "shared/game-rules.js" -Destination "backend/shared/game-rules.js"

# Of maak een post-install script
```

> **Tip:** Telkens als je `game-rules.js` aanpast, kopieer het opnieuw naar `backend/shared/`.

---

## Stap 8: Cloud Functions Deployen

```bash
cd backend
npm install
cd ..
firebase deploy --only functions
```

Dit deploy je 6 Cloud Functions:
- `createGame`
- `joinGame`  
- `startGame`
- `chooseGoal`
- `playMove`
- `passMove`
- `getGameState`
- `cleanupOldGames`

---

## Stap 9: Firestore Rules Deployen

```bash
firebase deploy --only firestore:rules
```

---

## Stap 10: Testen (Lokaal)

Je kunt alles lokaal testen met de Firebase Emulator:

```bash
firebase emulators:start
```

Dit start:
- Functions emulator op `http://localhost:5001`
- Firestore emulator op `http://localhost:8080`
- UI op `http://localhost:4000` (emulator dashboard)

Open `multiplayer.html` in je browser om te testen.

> **Tip:** Voor lokaal testen, voeg dit toe aan je init code:
> ```javascript
> // Alleen voor lokaal testen!
> mp.functions.useEmulator("localhost", 5001);
> mp.db.useEmulator("localhost", 8080);
> mp.auth.useEmulator("http://localhost:9099");
> ```

---

## Stap 11: Hosting (Optioneel)

Wil je het online zetten?

```bash
firebase deploy --only hosting
```

Of gebruik GitHub Pages voor de frontend en Firebase Functions voor de backend.

---

## 📁 Project Structuur

```
Locus -MP/
├── index.html              ← Originele singleplayer game
├── multiplayer.html        ← Multiplayer entry point
├── multiplayer.css          ← MP styling
├── responsive.css           ← Originele responsive CSS
│
├── shared/
│   └── game-rules.js       ← Pure game logic (server + client)
│
├── client/
│   ├── multiplayer-client.js ← Firebase ↔ UI adapter
│   └── lobby-ui.js          ← Lobby, scoreboard, UI controller
│
├── backend/
│   ├── firebase-functions.js ← Cloud Functions (server logic)
│   ├── package.json          ← Node.js dependencies
│   └── shared/
│       └── game-rules.js     ← Kopie voor Cloud Functions
│
├── firestore.rules           ← Database beveiligingsregels
└── FIREBASE-SETUP.md         ← Deze setup gids
```

---

## 🔧 Architectuur Overzicht

```
┌─────────────┐     HTTPS Callable      ┌──────────────────┐
│   Browser    │ ──────────────────────▶ │  Cloud Functions  │
│   (Client)   │                         │  (Server Logic)   │
│              │ ◀─ Firestore Realtime ─ │                    │
│  - lobby-ui  │    onSnapshot listener  │  - createGame     │
│  - mp-client │                         │  - joinGame       │
│  - game-rules│                         │  - playMove       │
│              │                         │  - game-rules     │
└─────────────┘                         └──────────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │   Firestore   │
                                        │  (Database)   │
                                        │               │
                                        │  games/       │
                                        │  inviteCodes/ │
                                        └──────────────┘
```

---

## 🎯 Game Flow

1. **Lobby** → Speler maakt game of joint met invite code
2. **Wachtkamer** → Host wacht tot er genoeg spelers zijn
3. **Doelstelling** → Iedereen kiest 1 van 3 geheime doelen
4. **Gameplay** → Turn-based: speel kaarten op het shared board
5. **Resultaten** → Scores + objective bonus → winnaar

---

## ❓ Veel Voorkomende Problemen

### "Firebase is not defined"
→ Check dat de Firebase SDK scripts geladen zijn vóór je eigen scripts.

### "Permission denied" bij Firestore
→ Deploy je Firestore rules: `firebase deploy --only firestore:rules`

### "Function not found"
→ Deploy je functions: `firebase deploy --only functions`

### Lokaal testen werkt niet
→ Check dat de emulators draaien: `firebase emulators:start`

---

## 🚀 Volgende Stappen

Na de basis:
1. **Shop systeem** — Munten + upgrades kopen tussen rondes
2. **Timer** — Optionele tijdslimiet per beurt
3. **Spectator mode** — Meekijken zonder te spelen
4. **Meer levels** — World 2, 3, 4 borden voor MP
5. **Ranking / leaderboard** — Score historie
