# Sahara Dashboard

Tauri v2 desktop app for controlling the Sahara Discord bot.

## Setup (Mac)

```bash
git clone <repo-url>
cd tauri-bot-dashboard
npm install
npm run tauri dev      # dev mode with hot reload
npm run tauri build    # production .dmg/.app
```

## Auto-Update
Push a tag `v*` to trigger GitHub Actions Mac build + auto-update.

## Features
- Live activity feed across all servers
- Flagged message approve/deny menus
- Loading animations (framer-motion)
- Desktop notifications
- Premium feature gating
EOF