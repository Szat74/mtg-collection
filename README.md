# 🃏 Arcane Index — MTG Collection Manager

A self-hosted Docker app for managing your Magic: The Gathering card library, powered by the Scryfall API.

---

## Deployment (GitHub → OMV)

This repo uses **GitHub Actions** to automatically build Docker images and push them to GitHub Container Registry (ghcr.io). Your NAS just pulls the images — no build tools needed.

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create mtg-collection --public --source=. --push
# or manually:
# git remote add origin https://github.com/YOUR_USERNAME/mtg-collection.git
# git push -u origin main
```

The Actions workflow triggers on every push to `main`. Check the **Actions** tab — first build takes ~3 minutes.

### Step 2 — Make packages public (easiest option)

After the first Actions run, go to `https://github.com/YOUR_USERNAME?tab=packages`, click each package → **Package settings → Change visibility → Public**. This lets OMV pull without credentials.

### Step 3 — Create the data directory on your NAS

```bash
sudo mkdir -p /srv/mtg-collection/data
```

### Step 4 — Deploy on OMV

Use `omv-compose.yml` in OMV's Compose / Portainer stack UI:

1. OMV → **Services → Docker → Compose** (or Portainer → Stacks)
2. Paste the contents of `omv-compose.yml`
3. Replace `YOUR_GITHUB_USERNAME` (lowercase) with your GitHub username
4. Deploy → access at **http://your-nas-ip:8080**

---

## Updating

Push a commit → Actions rebuilds images → on OMV run:

```bash
docker compose pull && docker compose up -d
```

---

## Private repo / private packages

If your repo is private, OMV needs a pull credential:

1. GitHub → Settings → Developer Settings → Personal Access Tokens (classic) → new token with `read:packages`
2. On your NAS: `docker login ghcr.io -u YOUR_USERNAME -p YOUR_TOKEN`

---

## Bulk Import Format

```
Lightning Bolt
4 Counterspell
2 foil Thoughtseize
3 Llanowar Elves | Elf Tribal
1 foil Black Lotus | Power Vault
```

---

## Backup

```bash
cp /srv/mtg-collection/data/collection.db ./collection-backup-$(date +%Y%m%d).db
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cards` | List cards (`?search=`, `?deck=`, `?foil=`, `?sort=`, `?order=`) |
| POST | `/api/cards` | Add a card |
| PATCH | `/api/cards/:id` | Update quantity / foil / deck |
| DELETE | `/api/cards/:id` | Remove a card |
| GET | `/api/stats` | Collection statistics |
| GET | `/api/decks` | List deck names |
| POST | `/api/import` | Bulk import |
| GET | `/api/export/csv` | Download CSV |
