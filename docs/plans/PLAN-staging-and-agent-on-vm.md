# Staging Bot and Claude Code on the VM

Status: Planned (setup steps are LeeAnn's to run; nothing built yet)
Created: 2026-10-12
Last Updated: 2026-10-12

## Why

The bot now runs on a Hetzner VM we fully control (see `docs/reference/HOSTING.md`). That makes
two things possible that the old host blocked:

1. **A staging bot**, so a change can be tried in Discord before it goes to `main`.
2. **Claude Code running on the VM**, so an agent can run that staging bot, seed and wipe its
   data, run tests against a real MariaDB, and read logs. It can't do any of that from a cloud
   session, which can't reach the server.

The catch is that production lives on the same box. So everything below is set up so the agent
**physically can't reach production**: it gets no root and no Docker, can't read the production
`config.json`, and has a database user that only sees the staging database. Production stays
something only LeeAnn deploys, through Coolify.

What an agent still can't do is click through Discord. Bots can't press another bot's buttons or
run its slash commands, and automating a user account breaks Discord's terms. The clicking, and
judging how a panel feels, stays with LeeAnn. The agent handles everything around that.

## Setup steps (run as root, in this order)

### 1. A Linux user for the agent

```bash
adduser --disabled-password --gecos "" claude
# Do NOT add it to the docker or sudo groups. Membership in docker is root-equivalent and
# would let it reach the production container and its config.json.
loginctl enable-linger claude   # lets its staging service keep running when nobody is logged in
```

### 2. A staging database and DB user

In `mariadb` as root:

```sql
CREATE DATABASE storybot_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'storybot_staging'@'localhost' IDENTIFIED BY '<pick a password>';
GRANT ALL PRIVILEGES ON storybot_staging.* TO 'storybot_staging'@'localhost';
FLUSH PRIVILEGES;
```

The staging database is encrypted at rest automatically like every other table on this server
(`innodb_encrypt_tables = FORCE`). The key file stays root-only, so the `claude` user can't read it.

### 3. A staging Discord application and test server

- In the Discord Developer Portal, create a second application (e.g. "StoryBot Staging") and give
  it the same privileged intents as production. Copy its token and application id.
- Make a private test server and invite the staging bot with the same invite permissions listed in
  `HOSTING.md`.
- **Don't invite the staging bot to the Hub server.** See "Open question: the Hub" below.

### 4. Install Claude Code as the `claude` user

```bash
su - claude
curl -fsSL https://claude.ai/install.sh | bash
claude          # first run: log in with LeeAnn's Claude account. With no browser on the server it
                # prints a link to open on another machine, then you paste the code back.
```

### 5. The staging checkout and config

Still as `claude`:

```bash
git clone https://github.com/shantismurf/round-robin-storybot.git ~/storybot-staging
cd ~/storybot-staging
npm install
cp config.example.json config.json
```

Fill in `config.json` with the **staging** token and application id, the test server's id as
`guildId`, `"testMode": true`, and a `db` block pointing at `localhost` / `storybot_staging` with
the staging DB user. Nothing from the production `config.json` goes in here.

### 6. Run the staging bot as a service

A user-level systemd service lets the agent restart it without root. As `claude`, create
`~/.config/systemd/user/storybot-staging.service`:

```ini
[Unit]
Description=StoryBot staging

[Service]
WorkingDirectory=%h/storybot-staging
ExecStart=/usr/bin/env node index.js
Restart=on-failure

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now storybot-staging
journalctl --user -u storybot-staging -f   # its logs
```

The first start runs `deploy.js` against the empty `storybot_staging` database. That builds the
schema from `db/init.sql` plus the migrations, syncs config, and registers commands in the test
server. It doubles as the first real fresh-install check this repo has had, so watch that log.

### 7. Connect it to the project

As `claude`, in `~/storybot-staging`:

```bash
claude remote-control
```

From then on, a thread in the Claude project can start a session in that folder. LeeAnn approves
it, and it reports back into the thread.

## Open question: the Hub

Hub ids (`cfgHubServerId`, `cfgHubLogChannelId`, the FAQ and announcement channels) live in
`db/config_files/config_system.sql` and are re-synced on every startup, so staging will point at
the **production Hub** too, and an override written to the staging DB would be overwritten on
the next start. Because the staging bot isn't a member of the Hub server, those calls fail
instead of posting. Expect some "failed" lines in the staging log from the hub log mirror, FAQ
sync and privacy-policy post.

That's safe, but noisy. The clean fix is a small code change: let `config.json` override the
hub ids, plus a startup check that refuses to run with `testMode` on and the production Hub id.
`hub-brainstorming.md` already calls for that check. **Not built. LeeAnn decides whether it's
worth doing.**

## Next build, once the setup works (not started)

- **Seed and reset script** for the staging DB. One command, no required arguments, safe to run
  repeatedly. It wipes `storybot_staging` and fills it with stories in useful states (active,
  paused, completed, several writers, a turn about to time out), then prints what it made. The
  shape comes from `hub-brainstorming.md`'s "Seed script" note. Real Discord ids (threads,
  messages) are the hard part, because seeded rows point at things that don't exist in the test
  server. Settle that in the design before building.
- **Migration check** (lower priority, per LeeAnn): run the schema and config sync against a
  scratch database before a change reaches `main`. Step 6's first start already covers the
  fresh-install case once.
