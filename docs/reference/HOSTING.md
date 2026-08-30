# Production Hosting — bot-hosting.net (Pterodactyl)

## Access

- No shell/console access — the Pterodactyl panel's Console tab only shows
  the container's stdout, it does not accept commands.
- No local/staging environment. Every change ships by pushing to `main`
  and restarting the bot from the panel.
- **Restart** (re-runs the startup command below against the existing
  container filesystem) is the normal deploy action, used every time.
  **Reinstall** (wipes and reprovisions the container) takes several
  minutes and is only used if something is broken badly enough to need it.
- A git push does **not** trigger a restart by itself — the panel restart
  has to be triggered manually after pushing.

## Startup command

Runs on every restart:

```bash
if [[ -d .git ]] && [[ ${AUTO_UPDATE} == "1" ]]; then git pull; fi;
if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi;
if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi;
if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi;
if [[ ! -z "${START_BASH_FILE}" ]]; then
  bash ${START_BASH_FILE};
else
  /usr/local/bin/node /home/container/${BOT_JS_FILE};
fi;
```

In order: pull `main` into the persistent `/home/container` directory (not
a fresh clone), run `npm install`, then run `node index.js`
(`START_BASH_FILE` is unset for this project). `index.js` first waits for
the DB to be reachable (see quirk below), then fires `deploy.js` — schema
migrations, config sync, command registration, hub post sync — before
connecting to Discord; see `CLAUDE.md`'s **Startup** bullet.

## Fixed quirk: package-lock.json

`npm install` (step 3, running every restart in the same persistent
directory) could rewrite `package-lock.json` on its own, even with no
`package.json` change, leaving it locally modified. The next restart's
`git pull` would then refuse to overwrite that local change and abort with
`error: Your local changes to the following files would be overwritten by
merge: package-lock.json`.

Fixed by removing `package-lock.json` from git tracking (`.gitignore`) —
`npm install` now regenerates it locally every restart with nothing for
`git pull` to conflict with.

## config.json

Not in git (`.gitignore`). It lives directly in the container's files on
the host and is not touched by `git pull`. A local backup copy is kept
outside the repo in case it needs to be re-uploaded.

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

## Database

**As of 2026-08-30, self-hosted on a separate Hetzner Cloud VM** — no longer the
bot-hosting.net-provided DB used previously. Moved specifically because
bot-hosting.net does not offer InnoDB/infrastructure-level encryption at
rest and had no path to enable it, which Discord's privileged-intent
application data-handling questions required an honest answer on. The
bot *application* itself still runs on bot-hosting.net, unchanged — only
the database moved.

- **Host**: Hetzner Cloud VM (CX22: 2 vCPU / 4GB RAM / 40GB disk, Ubuntu,
  ~$6.49/mo), IP `95.217.14.153`, server name `storybot`.
- **Encryption at rest**: MariaDB's `file_key_management` plugin,
  configured in `/etc/mysql/mariadb.conf.d/60-encryption.cnf`, key file at
  `/etc/mysql/encryption/keyfile.txt` (600 perms, `mysql:mysql` owner —
  **not backed up anywhere else**; losing this file makes all data
  unrecoverable, see the backup gap below). `innodb_encrypt_tables =
  FORCE` and `innodb_encrypt_log = ON` are set globally, so every InnoDB
  table is encrypted automatically — no per-table `ENCRYPTED=YES` needed
  anywhere in schema/migrations.
- **Network access**: MariaDB's `bind-address` is `0.0.0.0` (listens on
  all interfaces), but `ufw` only allows inbound port 3306 from
  bot-hosting.net's outbound IP (`65.21.16.214` — see stability caveat
  below). SSH (root, key-only auth) is the only other open port.
- **App connection user**: `storybot`@`65.21.16.214` — IP-restricted at
  the MySQL grant level too, not just the firewall; not root. Credentials
  live in `config.json` on bot-hosting.net (not in git), same convention
  as before.
- **SSH access**: key-based only (the instance's initial bootstrap state
  was password-only, emailed on creation; replaced with a key before any
  real configuration). Root user — no separate sudo/non-root account set
  up yet.
- **Backups**: **none configured yet.** Hetzner's backup service was
  skipped at creation to avoid the extra cost, and no scripted
  mysqldump-to-somewhere-else exists either. This is a real, currently
  unaddressed gap — a corrupted disk or a lost encryption keyfile means
  real, unrecoverable data loss today. Worth fixing soon; not yet done as
  of this writing.

### Known caveat: bot-hosting.net's outbound IP isn't confirmed stable

The firewall/grant restriction above uses `65.21.16.214`, resolved by a
one-time DNS lookup of `prem-eu2.bot-hosting.net` (the Pterodactyl panel's
own hostname) on 2026-08-30 — bot-hosting.net has not confirmed this IP
is fixed for the life of the account, and hosting providers sometimes
migrate accounts between nodes for maintenance/rebalancing. If that ever
happens, the bot loses its database connection outright (should surface
clearly via the DB-unreachable retry logging in `index.js`/`job-runner.js`,
not silently). Accepted as a short-term risk rather than solved properly
(e.g. a persistent VPN/tunnel) since a full bot migration off
bot-hosting.net entirely is already on the roadmap (see `TODO.md`) — if
that happens, this whole caveat becomes moot. If the DB connection ever
fails unexpectedly with no other explanation, re-resolve
`prem-eu2.bot-hosting.net` and compare against the current `ufw`/grant
rule first.

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
  longer used by the bot as of this cutover, but has **not been
  deleted** — it still holds a full, now-increasingly-stale copy of
  everything up to the migration moment. Decommission it once the new
  setup has proven stable for a while.

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
