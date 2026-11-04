# Querying the Production Database from a Laptop

Written 2026-11-04. How to look at the live `storybot` database in MySQL Workbench, plus the
one-line backup to take before anything risky. See [HOSTING.md](HOSTING.md) for the server
itself.

**The short version:** MariaDB is never exposed to the internet for this. Workbench opens an
SSH connection to the server on port 22, which is already open, and talks to the database
through it. Nothing in the firewall changes, and port 3306 stays closed to the outside.

## What you need

- The SSH private key that already gets you into the server as `root`, on this laptop.
- MySQL Workbench 8.x.
- The server: `95.217.14.153`, user `root`. The database is `storybot`.

## Step 1: Check that SSH works from this laptop

Open Terminal (Mac) or PowerShell (Windows) and run:

```
ssh root@95.217.14.153
```

If you land at a `root@storybot` prompt, SSH works. Workbench will need the path to the key
file that just worked, usually one of these:

- Mac: `/Users/<you>/.ssh/id_ed25519` (or `id_rsa`)
- Windows: `C:\Users\<you>\.ssh\id_ed25519` (or `id_rsa`)

If it says `Permission denied (publickey)`, this laptop doesn't hold your key. Either copy the
key over from the machine that does, or give this laptop its own key:

1. On the laptop: `ssh-keygen -t ed25519`, accept the default path, set a passphrase.
2. Print the public half: `cat ~/.ssh/id_ed25519.pub` (Mac) or
   `type $env:USERPROFILE\.ssh\id_ed25519.pub` (Windows). It is one line starting
   `ssh-ed25519`.
3. In the Hetzner Cloud console, open the `storybot` server and click **Console**, which gives
   you a root terminal in the browser. Append that line to `/root/.ssh/authorized_keys`.
   Append, never overwrite: replacing the file locks out every other key you have.
4. Try `ssh root@95.217.14.153` again.

Stay logged in for the next two steps.

## Step 2: Take a backup

There are no automatic backups yet (see [HOSTING.md](HOSTING.md)), so take one by hand before
any deploy that changes the schema, and whenever you are about to change data yourself. On the
server:

```
mariadb-dump --single-transaction --routines --triggers storybot > /root/storybot-$(date +%F).sql
ls -lh /root/storybot-*.sql
```

`--single-transaction` takes a consistent snapshot without locking the bot out. The file is
plain SQL, so restoring it doesn't depend on the encryption key file, which makes it the
only copy of the data that survives losing that key. That also means it is **not encrypted**:
keep it on the server, or somewhere only you can read.

If `mariadb-dump` says access denied, run it as `mariadb-dump -u root -p ...` and enter the
database root password.

## Step 3: Create a read-only login for Workbench

Still on the server, open the database prompt:

```
mariadb
```

Then, with a long password of your own in place of the placeholder:

```sql
CREATE USER 'workbench_ro'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-long-password';
GRANT SELECT, SHOW VIEW ON storybot.* TO 'workbench_ro'@'127.0.0.1';
exit
```

Read-only on purpose: with this login, nothing you run in Workbench can change or delete
anything, so you can explore freely. When you do need to change data, do it deliberately as
root on the server, after a backup. Keep the password out of the repo and out of
`config.json`.

You can log out of SSH now (`exit`).

## Step 4: Add the connection in Workbench

On Workbench's home screen, click **+** next to **MySQL Connections** and fill in:

| Field | Value |
|---|---|
| Connection Name | `Storybot (read-only)` |
| Connection Method | **Standard TCP/IP over SSH** |
| SSH Hostname | `95.217.14.153:22` |
| SSH Username | `root` |
| SSH Key File | the key path from Step 1 |
| MySQL Hostname | `127.0.0.1` |
| MySQL Server Port | `3306` |
| Username | `workbench_ro` |
| Password | **Store in Keychain** (Mac) / **Store in Vault** (Windows), then the password from Step 3 |
| Default Schema | `storybot` |

The MySQL Hostname is `127.0.0.1` because it is read from the server's side of the tunnel, so it
means "this same machine".

Click **Test Connection**. The first time, Workbench asks you to accept the server's
fingerprint: accept it. Then **OK**, and double-click the new tile to connect.

## If it doesn't connect

**Access denied for user `workbench_ro`.** The login exists for a different address than the
one the connection arrives from. On the server, check what was created:

```sql
SELECT user, host FROM mysql.user WHERE user = 'workbench_ro';
```

**Can't connect to MySQL server (not access denied).** MariaDB may be listening only on the
address the bot uses. On the server, run `ss -ltnp | grep 3306`. If it shows `10.0.1.1:3306`
and no `0.0.0.0` or `127.0.0.1`, put `10.0.1.1` in Workbench's MySQL Hostname, and create the
login for that address instead (`'workbench_ro'@'10.0.1.1'` in both lines of Step 3).

**The SSH step fails in Workbench, but `ssh` works in the terminal.** Workbench can be fussy
about some key formats. Skip its SSH handling and open the tunnel yourself. In a terminal,
leave this running:

```
ssh -N -L 3307:127.0.0.1:3306 root@95.217.14.153
```

Then make a second Workbench connection with Connection Method **Standard (TCP/IP)**, Hostname
`127.0.0.1`, Port `3307`, and the same username and password. The tunnel lasts as long as that
terminal window stays open.

## What not to do

- **Don't open port 3306 in the firewall** for this. The tunnel doesn't need it, and it would
  put the database on the internet. The one 3306 rule that exists today is the old
  bot-hosting.net rollback path described in [HOSTING.md](HOSTING.md), and it should be closed,
  not copied.
- **Don't connect Workbench as `root` or as the bot's own `storybot` user.** Use the read-only
  login, so a slip in Workbench can't touch live stories.
