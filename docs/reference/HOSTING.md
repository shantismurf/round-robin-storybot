# Production Hosting — Hetzner Cloud + Coolify

**As of 2026-10-12**, the bot process and its MariaDB database both run on one Hetzner Cloud
VM. The bot runs as a Coolify application on that VM, and there is full root access to the box.

Before that, the bot ran on bot-hosting.net (a Pterodactyl panel with no shell, no way to run
scripts, and no staging), and from 2026-08-30 only the database lived on this VM. The whole
bot-hosting.net account was deleted on 2026-11-06, so there is nothing left to roll back to. Its
history is kept at the bottom of this file because the incident notes are still useful. The CX22
sizing below was chosen for the DB alone, so check memory and disk headroom if the bot starts
misbehaving under load. The VM and its MariaDB now also serve Agshar (see "Other apps on this
VM" below), so that headroom matters more than it did.

## Server

- **Host**: Hetzner Cloud VM (CX22: 2 vCPU / 4GB RAM / 40GB disk, Ubuntu), IP
  `95.217.14.153`, server name `storybot`.
- **SSH**: root, key-only auth. No separate sudo/non-root account set up yet. Password login
  was in fact enabled until **2026-11-06** (cloud-init's `/etc/ssh/sshd_config.d/50-cloud-init.conf`
  sets `PasswordAuthentication yes`), and `journalctl -u ssh` showed bots guessing root and other
  usernames from public addresses. It is now off through
  `/etc/ssh/sshd_config.d/00-no-password.conf` (`PasswordAuthentication no`). Files in that folder
  are read in order and the first value wins, so the `00-` name overrides cloud-init's file, which
  cloud-init may rewrite. The allowed keys (`ssh-keygen -lf ~/.ssh/authorized_keys`) are the
  owner's PC key, the owner's phone key (ConnectBot) and **Coolify's own key, which must not be
  removed** or Coolify loses control of the server. To add a device, give it its own key and append
  its public key to `~/.ssh/authorized_keys`.
- **Coolify**: runs on the same VM and manages the bot's container (deploys, restarts, logs).

## Deploying

- The bot is a Coolify application built from this repo's `main` branch. It started on
  Coolify's default **Nixpacks** build. The repo has had a `Dockerfile` since PR #86
  (`node:22-slim`, packages installed in their own cached layer, then `node index.js`), which
  takes effect once the app's Build Pack is set to Dockerfile. Nixpacks reinstalled every
  package on each deploy (about 100 seconds).
- **Deploys are manual right now.** Push to `main`, then hit **Redeploy** in the Coolify
  dashboard, which pulls the new commit and rebuilds. A plain Restart reuses the image Coolify
  already built, so it won't pick up new code.
  Coolify can auto-deploy on every push to `main` (through its GitHub integration or a
  webhook). That's wanted but not switched on yet.
- On startup, `index.js` waits for the DB to answer (`waitForDatabase()`), then runs
  `deploy.js`: schema migrations, config sync, command registration, hub post sync. After that
  it connects to Discord. See `CLAUDE.md`'s **Startup** bullet.
- **Logs**: the bot's stdout/stderr shows up in the application's Logs view in Coolify. The
  `#logs` channel on the hub server still gets the `show: true` problem lines (see the Logging
  Rules in `CLAUDE.md`).

## config.json

Not in git (`.gitignore`), and kept out of the image by `.dockerignore`. Coolify supplies it as
a **File Mount** at `/app/config.json`, so redeploys don't touch it. The format is the same as before. The only value that changed in
the move is `db.host`, now `10.0.1.1`, which is the address the bot's container uses to reach
MariaDB on the VM. The code reads only `config.json`, not environment variables.

## Running scripts by hand

This used to be impossible. Now the helper scripts in `helper/` can run inside the bot's
container (Coolify's terminal, or `docker exec` over SSH), for example
`node helper/broadcast.js` for a broadcast dry run. **Be careful:** they read the same
`config.json` as the running bot, so they use the production token and production database.
There is no staging bot yet.

## package-lock.json

Still untracked (`.gitignore`). That was a workaround for the old host, where `npm install`
in a persistent directory rewrote the lock file and the next `git pull` refused to run.
Each Coolify deploy builds fresh, so that conflict can't happen here. Without a lock file, though,
every build installs the newest versions `package.json` allows. That already bit once: the
first Coolify build pulled mysql2 3.24.x, which parses JSON columns itself and broke every
background job (fixed in `job-runner.js`, see the Unreleased changelog entry). Tracking the lock
file again would make builds reproducible, but that hasn't been decided yet.

## Database

MariaDB runs directly on the VM (not as a Coolify-managed database). It was set up on
2026-08-30, when only the DB moved here. The bot moved on 2026-10-12. The DB setup didn't
change in that move except that the bot now connects from the same machine.

- **Encryption at rest**: MariaDB's `file_key_management` plugin, configured in
  `/etc/mysql/mariadb.conf.d/60-encryption.cnf`, key file at
  `/etc/mysql/encryption/keyfile.txt` (600 perms, `mysql:mysql` owner). **The key file is not
  backed up anywhere else.** If it's lost, all the data is unrecoverable. `innodb_encrypt_tables =
  FORCE` and `innodb_encrypt_log = ON` are set globally, so every InnoDB table is encrypted
  automatically and no per-table `ENCRYPTED=YES` is needed anywhere in schema/migrations.
- **Connection**: the bot connects to `10.0.1.1` from its container. The `storybot` app user
  is not root. Its credentials live in `config.json` (see above).
- **Network access**: the bot connects locally, from its container to `10.0.1.1`. The only
  `ufw` allow rule for port 3306 is `10.0.1.0/24`, the `coolify` Docker network. The old rule
  for bot-hosting.net's outbound IP (`65.21.16.214`) and the `storybot`@`65.21.16.214` login
  were removed on 2026-11-06, after the bot-hosting.net account was deleted.
- **Backups**: Hetzner server backups are enabled. They are whole-server snapshots, so they
  include the database files and the encryption key file together, but a restore brings back the
  whole server, not one database or table. A `mysqldump` now and then gives a portable copy.
  Keep a second copy of `/etc/mysql/encryption/keyfile.txt` somewhere outside Hetzner's account.

## Other apps on this VM

Agshar (a Discord Activity bot and API, repo `shantismurf/agshar`) runs as a second Coolify
application on this VM and uses the same MariaDB. It has its own `agshar` database, and its own
accounts. The accounts are limited to their own database on purpose:

| Account | Host | Access |
|---|---|---|
| `storybot` | `10.0.1.%` | this bot, `storybot` database |
| `storybot_admin` | `127.0.0.1` | MySQL Workbench through the SSH tunnel, `storybot` database only |
| `agshar`, `agshar_admin` | `10.0.1.%`, `127.0.0.1` | Agshar's bot, and Workbench, `agshar` database only |
| `root`, `mysql`, `mariadb.sys` | `localhost` | local administration |

Agshar's own deployment notes (Coolify setup, network rules, the data copy recipe) are in that
repo's `docs/hetzner-deployment.md`.

### Connecting with MySQL Workbench

MariaDB is not open to the internet. Workbench goes through an SSH tunnel started from the
owner's PC. `~/.ssh/config` there has a `storybot` shortcut (`HostName 95.217.14.153`,
`User root`, `IdentityFile ~/.ssh/ssh-key-2026-08-24.key`). In a new PowerShell window, leave this
running (it prints nothing, which is success):

```
ssh -N -L 3307:127.0.0.1:3306 storybot
```

Then use a plain **Standard TCP/IP** connection in Workbench to `127.0.0.1`, port `3307`, with
user `storybot_admin`. Through the tunnel MariaDB sees the connection as coming from `127.0.0.1`,
which is why the admin accounts are `…@'127.0.0.1'`. Typing `ssh root@95.217.14.153` instead
skips the shortcut and falls back to a password prompt. Workbench's own "over SSH" connection
type and the `dbtunnel` SSH user were never made to work and are not needed.

### Firewalls

There are two, and traffic has to pass both. The **`ufw`** firewall on the VM allows only
`10.0.1.0/24` into port 3306. The **Hetzner cloud firewall** (Hetzner console) has inbound rules
for SSH (22) and the Coolify dashboard (8000) from the owner's home IP only, plus ICMP. If the
home IP changes, SSH and the dashboard stop working until those two rules are updated. A leftover
rule for TCP 20343 (bot-hosting's old Agshar port) was removed on 2026-11-06. This cloud firewall
is evidently **not applied to the server**: its SSH rule only allows the owner's home IP, yet
`journalctl -u ssh` logs password-guessing attempts from other addresses. The server is
protected by `ufw`, and now by key-only SSH. Before ever applying the cloud firewall, add rules
for ports 80 and 443 (Coolify's proxy), or the apps and their HTTPS certificates break.

## Bot invite/install link

Canonical link is the one listed on [top.gg](https://top.gg) — verified 2026-08-26 to carry the
correct scopes (`bot`, `applications.commands`) and all ten permissions
`commands/_storyadminSetup.js`'s `feedRequired` list checks for on the story feed channel: View
Channel, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages, Pin
Messages, Create Public Threads, Create Private Threads, Manage Threads.

It also grants **Manage Roles**, which nothing in the codebase currently uses — setup only edits
channel-level permission overwrites, never role permissions directly. Kept intentionally: the
original intent was for the setup panel to optionally handle admin-role creation/configuration
itself, which would need it. Not yet built.

A link freshly regenerated from the Developer Portal's OAuth2 URL Generator is **not guaranteed
to match** — one generated 2026-08-26 while checking this was missing Attach Files. If top.gg's
link is ever lost or needs replacing, regenerate from the Portal and diff the resulting
permissions integer against the list above (or recheck each box by hand) before treating it as a
drop-in replacement, rather than assuming a fresh generation is automatically correct.

---

# Legacy: bot-hosting.net (Pterodactyl), until 2026-10-12

The bot-hosting.net slot was stopped on 2026-10-12 and **deleted on 2026-11-06**, together with
its database and the account's other bots (Agshar, ficfeed). Back then:

- There was no shell. The panel's Console tab showed stdout only, and every change, including
  debug logging, shipped by pushing to `main` and restarting from the panel.
- The startup command `git pull`ed into a persistent `/home/container` directory, ran
  `npm install`, then `node index.js`. That is where the `package-lock.json` conflict above
  came from.
- The DB firewall rule depended on bot-hosting.net's outbound IP, which was never confirmed
  stable. Running both on one VM makes that caveat moot.

### Migration notes (2026-08-30)

- Full schema + data copied in one shot, run directly on the Hetzner box:
  `mysqldump --skip-ssl -h us.mysql.db.bot-hosting.net -P 3306 -u
  <old_user> -p'<old_password>' s388541_ficfeed_test_tracker | mysql
  storybot`. The `--skip-ssl` flag was required — MariaDB 11.8's client
  tools require SSL by default, and the old bot-hosting.net DB host
  doesn't support it, otherwise failing with `TLS/SSL error: SSL is
  required, but the server does not support it`.
- The old bot-hosting.net-provided database
  (`s388541_ficfeed_test_tracker` on `us.mysql.db.bot-hosting.net`) is no
  longer used by the bot as of this cutover. It was kept as a stale
  copy of everything up to the migration moment, and was deleted
  along with the whole bot-hosting.net account on 2026-11-06.

### Known quirk (legacy bot-hosting.net DB, kept for reference): DB outage from disk-full crash, no uptime visibility

This entire incident predates the 2026-08-30 migration above and describes
the old bot-hosting.net-provided database, not the current Hetzner one —
kept here because the failure-mode understanding and recovery steps are
still generically useful if anything similar ever recurs.

Confirmed 2026-08-13 (host support): the legacy DB node's disk filled up,
which crashed MariaDB and left it down for hours. Timeline from the
2026-08-13 incident (all times local, matching Discord's rendering):

1. **10:10 PM** — a single ECONNREFUSED blip on the job runner poll, the
   first sign of trouble. Recovered on its own within the minute.
2. **3:40 AM** — degraded-but-alive: a `doFinalizeEntry` transaction
   commits fine (entry saved, current turn ended), but the immediately
   following `NextTurn` call fails on a MariaDB disk-full error surfacing
   through the driver, e.g. `NextTurn failed: Error: Disk got full writing
   '.(temporary)' (Errcode: 28 "No space left on device")` — the server
   rejecting a temp-file write, not a bot-side disk issue. Net effect: the
   story's entry is safely recorded, but the story is left with **no
   active turn** (see recovery note below).
3. **~4:03 AM** — a different story's entry finalizes and advances
   cleanly — the DB was still partially functional at this point, not yet
   fully down.
4. **6:22 AM onward** — mysqld goes fully down; every query now fails with
   `connect ECONNREFUSED <ip>:3306`, logged every tick by the job runner
   poll (`job-runner.js`, 60s interval). This isn't a single dead
   connection needing a code-level reconnect — `utilities.js`'s
   `DB.connect()` uses `mysql.createPool`, so the pool is dialing fresh
   sockets each time and getting refused because nothing is listening on
   that port. No self-recovery; needed host support to bring the node
   back up.

**Gotcha when cross-referencing console output against Discord:** the
console's `formattedDate()` prefix is UTC (`toISOString()`-derived), but
Discord renders its own message timestamps in local time. A console line
timestamped e.g. `08:40:25` is the *same moment* as `3:40 AM` in the
`#logs` channel (5-hour offset, at least during EDT) — don't assume a
console timestamp that looks like "now" is recent; convert it first.

**Recovery for a story left with no active turn:** open that story's
`/story manage` panel and use the turn-actions "Next" button — it
explicitly handles the no-active-turn case (`_manageTurnActions.js`,
`handleTurnActionSelectMenu`) and starts the selected writer's turn
immediately, no waiting on any background job.

The host pulled the community-made uptime monitor that used to show
legacy-node up/down status, so there's currently no passive way to see
this happening — it only surfaces via the log spam in `#logs`. No shell/
console access to check disk usage directly; confirm with host support or
the panel.

**Follow-up fixes (2026-08-13, v3.3.2 and v3.4.0):** two problems this
incident exposed have since been fixed in code —

- The `ECONNREFUSED` spam itself: every poll failure used to log
  identically to the hub channel forever. `job-runner.js` now uses a
  shared `createFailureThrottle()` helper (`utilities.js`) that alerts on
  every failure for the first 10 consecutive failures (so a real outage
  is unmistakable, not a one-off blip), then throttles to one "still
  failing" summary every 10 minutes until it recovers, then logs one
  recovery line. Console still gets every tick for traceability — only
  the hub channel is throttled.
- The bigger problem from this incident: restarting the bot *while the
  DB was still down* took the entire bot offline, not just the job
  runner, because `deploy()` needs a live DB and `index.js` treated any
  failure there — including plain unreachability — as fatal
  (`process.exit(1)`), which also tripped Pterodactyl's crash-loop guard
  ("Aborting automatic restart, last crash occurred less than 600 seconds
  ago"). The only way to know the DB was back was to blindly retry
  Restart. `index.js` now calls `waitForDatabase()` before `deploy()`,
  which polls quietly every 30s (using the same burst/summary throttle
  above) until the DB answers, then proceeds into `deploy()` and normal
  startup automatically — no manual restart-and-hope needed. A genuine
  deploy failure (bad migration, bad config) still fails fast as before;
  only plain unreachability retries.
