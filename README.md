# 🃏 Arcane Index — MTG Collection Manager

A self-hosted app for digitizing your Magic: The Gathering card library. Search cards via the Scryfall API, track every physical copy, assign cards to decks and binders, and browse your collection with full card art.

![Docker](https://img.shields.io/badge/docker-ready-blue) ![Scryfall](https://img.shields.io/badge/powered%20by-Scryfall-orange)

---

## Features

### Collection
- 🔍 **Search by name** with live Scryfall autocomplete, or jump straight to a printing using **set code + collector number** (e.g. `MH3 42`)
- ✨ **Foil tracking** — each physical copy is tracked individually and can be marked foil
- 🖼️ **Gallery & list views** — browse as card art tiles or a compact list; filter by name, set, foil, group, or deck/binder
- 🏷️ **Tags / groups** — create freeform tags and assign cards to multiple groups
- 💾 **CSV export** — download your full collection any time

### Decks
- 🗂️ **Deck management** — create named decks with optional format (Standard, Modern, Commander, etc.)
- ⚔️ **Commander support** — assign a commander and optional partner; color identity filtering applied automatically
- 🔎 **Format validation** — singleton rule, color identity, 4-copy limit, and rarity checks with a violations banner
- ⊞ **Grid view** — browse deck contents as card art, grouped and sorted
- ≡ **List view** — compact name-only list with color identity pips; click a card name to expand its art inline
- 🗂️ **Grouping** — group cards by type (Creature, Instant, Land…) or color in both grid and list views; groups are collapsible
- 🔤 **Sorting** — secondary sort by name or converted mana cost within any group

### Binders
- 📒 **Binder tracking** — separate location type for binders; same one-card-one-location rule as decks, no format restrictions
- Full CRUD — create, rename, and delete binders independently from decks

### Bulk Import
- 📋 **Paste a decklist** and import dozens of cards at once
- Supports standard decklist formats plus name-less **set + collector number** lines
- Assign a default location for the whole import, or route individual lines to different decks with `| Deck Name`

### Stats
- 📊 **Dashboard** — total cards, unique printings, foil count, collection value
- Rarity breakdown, per-deck breakdown, and per-binder breakdown with value bars

---

## Bulk Import Format

One card per line. Supported syntax:

```
Lightning Bolt
4 Counterspell
2 foil Thoughtseize
3 Llanowar Elves | Elf Tribal
1 foil Black Lotus (LEA) 232
MH3 42
2 foil ONE 115
```

| Format | Effect |
|---|---|
| `Card Name` | Add 1 copy |
| `4 Card Name` | Add 4 copies |
| `foil Card Name` | Mark as foil |
| `Card Name (SET) ###` | Pin to a specific printing |
| `Card Name \| Location` | Assign to a deck or binder |
| `SET ###` | Add by set code + collector number (no name needed) |
| `2 foil SET ###` | Foil copy by set + number |

Card names use fuzzy matching — `"lightning bolt"` works fine.

---

## Quick Deploy (Docker Compose)

No build step required. Pre-built images are hosted on GitHub Container Registry and pulled automatically.

### 1. Create a data directory

```bash
sudo mkdir -p /srv/mtg-collection/data
```

> You can use any path — just update the volume in the compose file to match.

### 2. Create your `docker-compose.yml`

```yaml
version: '3.9'

services:
  mtg-backend:
    image: ghcr.io/szat74/mtg-collection-backend:latest
    container_name: mtg-backend
    restart: unless-stopped
    volumes:
      - /srv/mtg-collection/data:/data
    networks:
      - mtg-net
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/stats"]
      interval: 30s
      timeout: 5s
      retries: 3

  mtg-frontend:
    image: ghcr.io/szat74/mtg-collection-frontend:latest
    container_name: mtg-frontend
    restart: unless-stopped
    ports:
      - "8080:80"
    depends_on:
      mtg-backend:
        condition: service_healthy
    networks:
      - mtg-net

networks:
  mtg-net:
    driver: bridge
```

### 3. Deploy

```bash
docker compose up -d
```

### 4. Open the app

Navigate to **http://localhost:8080** (or replace `localhost` with your server/NAS IP).

---

## OpenMediaVault (OMV) Setup

If you're running OMV with the Docker/Compose plugin:

1. SSH into your NAS and create the data directory:
   ```bash
   sudo mkdir -p /srv/mtg-collection/data
   ```
2. In OMV, go to **Services → Compose → Files → Add**
3. Paste the compose file from Step 2 above
4. Click **Deploy**
5. Access at **http://your-nas-ip:8080**

---

## Updating

Pull the latest images and restart:

```bash
docker compose pull
docker compose up -d
```

Or use [Watchtower](https://containrrr.dev/watchtower/) to handle updates automatically.

---

## Backup & Restore

Your entire collection is a single SQLite file.

**Backup:**
```bash
cp /srv/mtg-collection/data/collection.db ./collection-backup-$(date +%Y%m%d).db
```

**Restore:**
```bash
cp ./collection-backup-20260101.db /srv/mtg-collection/data/collection.db
```

---

## Changing the Port

Edit the `ports` line in the compose file:

```yaml
ports:
  - "9000:80"   # now accessible on port 9000
```

---

## Architecture

```
Browser → Nginx (port 8080)
              ├── /* → React frontend (static files)
              └── /api/* → Express backend (port 3001)
                               └── SQLite database (/data/collection.db)
                               └── Scryfall API (card data + images)
```

Images are built automatically via GitHub Actions on every push to `main` and published to GitHub Container Registry.

---

## API Reference

The backend exposes a REST API if you want to script against your collection.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cards` | List cards — supports `?search=`, `?deck=`, `?foil=`, `?sort=`, `?order=` |
| POST | `/api/cards` | Add a card |
| PATCH | `/api/cards/:id` | Update quantity, foil status, or deck |
| DELETE | `/api/cards/:id` | Remove a card |
| GET | `/api/stats` | Collection statistics |
| GET | `/api/decks` | List all decks and binders |
| POST | `/api/decks` | Create a deck or binder (`{ name, type: 'deck'|'binder', format? }`) |
| POST | `/api/import` | Bulk import (`{ text, deck_id? }`) |
| GET | `/api/export/csv` | Download full collection as CSV |
| GET | `/api/scryfall/search?q=` | Proxy to Scryfall card search |
| GET | `/api/scryfall/card/:set/:num` | Lookup card by set code + collector number |

---

## Contributing / Self-Building

Want to fork and modify this?

```bash
git clone https://github.com/Szat74/mtg-collection.git
cd mtg-collection
docker compose -f docker-compose.yml up --build
```

The dev `docker-compose.yml` builds images locally from source. Push to your own repo and GitHub Actions will publish your own images to ghcr.io automatically.

---

## Credits

Card data and images provided by [Scryfall](https://scryfall.com). Please respect their [API terms of use](https://scryfall.com/docs/api).
