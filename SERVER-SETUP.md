# LOCUS Multiplayer — Server Setup

Eigen server, geen Firebase, geen betaalplan. Alles gratis!

---

## Wat heb je nodig?

- **Node.js** (v18 of hoger) — heb je al geïnstalleerd
- Dat is alles!

---

## Stap 1: Installeer dependencies

Open een terminal en voer uit:

```bash
cd server
npm install
```

Dit installeert Express en Socket.IO (duurt ~10 seconden).

---

## Stap 2: Start de server

```bash
npm start
```

Je ziet dan:

```
  ╔═══════════════════════════════════════════╗
  ║   LOCUS MULTIPLAYER SERVER                ║
  ║                                           ║
  ║   🌐  http://localhost:3000               ║
  ║                                           ║
  ║   Deel je lokale IP met medespelers       ║
  ║   op hetzelfde netwerk!                   ║
  ╚═══════════════════════════════════════════╝

  📡 Netwerk: http://192.168.x.x:3000
```

---

## Stap 3: Spelen!

1. **Jij** opent `http://localhost:3000` in je browser
2. Vul je naam in en klik **"Nieuw Spel Maken"**
3. Je krijgt een **6-letter invite code** (bv. `ABC123`)
4. **Medespelers** openen `http://JOUW-IP:3000` in hun browser
5. Ze vullen hun naam + de invite code in en klikken **"Join Spel"**
6. Als iedereen er is, klik **"Start Spel"**

### Lokale IP vinden

De server toont je lokale IP automatisch bij het opstarten.
Je kunt het ook handmatig vinden:
- **Windows**: `ipconfig` → zoek naar `IPv4 Address`

### Belangrijk
- Alle spelers moeten op **hetzelfde WiFi/netwerk** zitten
- Of je gebruikt een tool als **ngrok** om het via internet te delen (gratis)

---

## Optioneel: Online spelen via ngrok

Wil je met vrienden spelen die NIET op hetzelfde netwerk zitten?

1. Download [ngrok](https://ngrok.com/) (gratis account)
2. Start je server: `npm start`
3. In een andere terminal: `ngrok http 3000`
4. Je krijgt een URL zoals `https://abc123.ngrok-free.app`
5. Deel die URL met je vrienden — klaar!

---

## Mapstructuur

```
Locus -MP/
├── server/            ← De game server
│   ├── server.js      ← Draai dit
│   └── package.json
├── client/            ← Frontend code
│   ├── multiplayer-client.js  (Socket.IO client)
│   └── lobby-ui.js    (UI controller)
├── shared/            ← Gedeelde game logica
│   └── game-rules.js  (server + client)
├── multiplayer.html   ← De multiplayer pagina
├── multiplayer.css    ← Styling
├── index.html         ← Origineel singleplayer spel
└── backup-firebase/   ← Oude Firebase bestanden (backup)
```

---

## Stoppen

Druk `Ctrl+C` in de terminal waar de server draait.

---

## Veelgestelde vragen

**Q: Kan ik de poort veranderen?**
A: Ja! Start met: `set PORT=8080 && npm start` (Windows) of `PORT=8080 npm start` (Mac/Linux)

**Q: Kan ik dit op een VPS deployen?**
A: Ja! Upload de hele map naar een VPS, installeer Node.js, en draai `npm start`. Gebruik pm2 voor altijd-aan: `npm install -g pm2 && pm2 start server.js`

**Q: Wat als een speler disconnected?**
A: De server onthoudt hun gamestate. Als ze de pagina herladen verbinden ze automatisch opnieuw. Na 5 minuten zonder spelers wordt een game opgeruimd.

**Q: Is het veilig?**
A: Alle game logic draait server-side — spelers kunnen niet valsspelen. Kaarten en doelstellingen van andere spelers zijn verborgen.
