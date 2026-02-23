# Locus Multiplayer — Hosting Gids

Er zijn **twee manieren** om Locus te spelen:

1. **Server modus** — een Node.js server draait het spel (Socket.IO)
2. **P2P modus** — één speler host het spel direct in de browser (WebRTC)

---

## 🌐 Optie 1: P2P (geen server nodig)

Open `multiplayer.html` in een browser — lokaal of via elke static file host.

1. Vul je naam in
2. Klik **🌐 Host P2P Spel**
3. Deel de **6-letter room code** met andere spelers
4. Andere spelers vullen de code in bij **🔗 Join P2P Spel**

### Vereisten
- Moderne browser (Chrome, Firefox, Edge, Safari 15+)
- Beide spelers moeten internet hebben (voor WebRTC signaling)
- De host-browser moet open blijven — als die dichtgaat stopt het spel

### Beperkingen
- Geen reconnect bij verbindingsverlies
- Prestatie hangt af van de host-browser
- Werkt mogelijk niet achter strenge bedrijfsfirewalls

---

## 🖥️ Optie 2: Dedicated Server

### Lokaal draaien

```bash
cd server
npm install
node server.js
```

Opent op `http://localhost:3000`. Deel je IP-adres op het lokale netwerk.

### Omgevingsvariabelen

| Variabele | Default | Beschrijving |
|-----------|---------|-------------|
| `PORT` | `3000` | Poortnummer |

---

## ☁️ Deploy naar de cloud

### Render.com (gratis tier)

1. Push je code naar een GitHub/GitLab repo
2. Ga naar [render.com](https://render.com) → **New Web Service**
3. Koppel je repo
4. Render detecteert automatisch `render.yaml` — klik **Deploy**
5. Je krijgt een URL zoals `https://locus-mp.onrender.com`

> **Let op:** Gratis tier slaapt na 15 min inactiviteit. Eerste request na slaap duurt ~30s.

### Railway.app

1. Ga naar [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
2. Koppel je repo
3. Railway detecteert Node.js automatisch
4. Stel `PORT` in als environment variable (of laat Railway dit doen)
5. Deploy — je krijgt een publieke URL

### Docker

```bash
# Build
docker build -t locus-mp .

# Run
docker run -p 3000:3000 locus-mp
```

Of met Docker Compose:

```yaml
version: '3'
services:
  locus:
    build: .
    ports:
      - "3000:3000"
    restart: unless-stopped
```

### Heroku

```bash
heroku create locus-mp
git push heroku main
```

De `Procfile` is meegeleverd.

---

## 📁 Bestandsstructuur

```
├── multiplayer.html      ← Hoofdpagina (lobby + spel)
├── multiplayer.css        ← Styling
├── responsive.css         ← Responsive design
├── client/
│   ├── lobby-ui.js        ← Lobby & game UI
│   ├── multiplayer-client.js  ← Socket.IO client
│   └── p2p-host.js        ← WebRTC P2P host/guest
├── shared/
│   └── game-rules.js      ← Spelregels (server + client)
├── server/
│   ├── server.js          ← Express + Socket.IO server
│   └── package.json
├── Dockerfile             ← Docker config
├── render.yaml            ← Render.com config
├── Procfile               ← Heroku config
└── package.json           ← Root package (voor cloud deploys)
```

---

## 🎮 Spelregels (nieuwe features)

### Kaart Aflegstapel
Bij het trekken van kaarten verdwijnt er altijd 1 kaart naar de **aflegstapel** (🗑️):
- Trek 3 kaarten → speel 1, **1 naar aflegstapel**, 1 terug naar trekstapel
- Trek 2 kaarten → speel 1, **1 naar aflegstapel**
- Trek 1 kaart → speel die of pas (bij pas gaat de kaart naar aflegstapel)

### 10 Levels, 4 Wins
- Een match bestaat uit maximaal **10 levels**
- De eerste speler met **4 level-overwinningen** wint de match
- Als na 10 levels niemand 4 wins heeft, wint de speler met de meeste wins
