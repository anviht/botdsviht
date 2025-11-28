Run the bot 24/7 — recommended deployment options

This repo's GitHub Actions should NOT be used to run the bot persistently (Actions jobs time out). Use one of the following hosting approaches:

1) VPS with systemd (recommended if you have a server)
- Copy the repo to the server, install Node.js 18, set env vars (see `.env.example`), run:

```powershell
npm ci
Run the bot 24/7 — recommended deployment options

This repo's GitHub Actions should NOT be used to run the bot persistently (Actions jobs time out). Use one of the following hosting approaches:

1) VPS with systemd (recommended if you have a server)
- Copy the repo to the server, install Node.js 18, set env vars (see `.env.example`), run:

```bash
npm ci
# run once to test
node bot/index.js
# or use systemd unit below
sudo cp deploy/viht-bot.service /etc/systemd/system/viht-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now viht-bot
sudo journalctl -u viht-bot -f
```

2) PM2 (process manager)
- Install pm2 globally on server: `npm i -g pm2`
- Start with ecosystem file:

```bash
pm2 start deploy/pm2.config.js --env production
pm2 save
pm2 startup
```

3) Platform-as-a-service (Railway, Render, Fly, Heroku alternatives)
- Create a new project, point to your GitHub repo and set environment variables in the service dashboard.
- Configure start command: `npm start`.

Environment variables required (examples):
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `GUILD_ID`
- `GEMINI_API_KEY`
- `AI_CHAT_CHANNEL_ID`
- `MESSAGE_CONTENT_INTENT` (true/false)
- `GUILD_MEMBERS_INTENT` (true/false)
- Optional: `SUBSCRIBER_ROLE_ID`, `ANNOUNCE_CHANNEL_ID`

Notes:
- GitHub Actions are for CI/deploy; they are not a replacement for a long-running host.
- Use `systemd` or `pm2` to auto-restart on crashes and to keep logs.

If you'd like, I can add a small deployment script for a chosen provider (e.g., Render, Railway) or prepare a Dockerfile.

Docker (recommended for easy, reliable deployment)
-----------------------------------------------
You can run the bot inside Docker and use docker-compose to keep it running with restart policies.

1) Build and run with docker-compose (from `deploy/` directory):

```bash
cd deploy
docker-compose up -d --build
```

2) Check logs:

```bash
docker logs -f viht-vpn-bot
```

3) Stop and remove containers:

```bash
docker-compose down
```

Notes:
- Put your `.env` file in the repository root (it is referenced by `deploy/docker-compose.yml`).
- The compose file uses `restart: unless-stopped` so the container will restart automatically on failure or reboot.
