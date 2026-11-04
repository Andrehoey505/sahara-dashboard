# Tunnel Setup - Connect Remote Staff

Since not all staff are on the same local network, you need a tunnel to expose the bot's API.

## Option 1: Cloudflare Tunnel (Free, Recommended)

1. Install cloudflared on the machine running the bot:
   ```bash
   # Mac: brew install cloudflared
   # Windows: winget install Cloudflare.cloudflared
   # Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   ```

2. Login:
   ```bash
   cloudflared tunnel login
   ```

3. Create a tunnel:
   ```bash
   cloudflared tunnel create sahara-bot
   ```

4. Configure (create ~/.cloudflared/config.yml):
   ```yaml
   tunnel: <your-tunnel-id>
   credentials-file: /path/to/credentials.json
   ingress:
     - hostname: sahara.yourdomain.com
       service: http://localhost:8080
     - service: http_status:404
   ```

5. Route DNS:
   ```bash
   cloudflared tunnel route dns sahara-bot sahara.yourdomain.com
   ```

6. Run:
   ```bash
   cloudflared tunnel run sahara-bot
   ```

7. In the app Settings tab, enter: `https://sahara.yourdomain.com`

## Option 2: ngrok (Quick, Free tier)

```bash
ngrok http 8080
```
Copy the https URL (e.g. https://abc123.ngrok.io) and paste in Settings.

## Note
The bot needs an HTTP API endpoint on port 8080. Add a simple FastAPI/Flask server to discord_moderation_bot.py that serves mod log data. See the bot's dashboard server code.