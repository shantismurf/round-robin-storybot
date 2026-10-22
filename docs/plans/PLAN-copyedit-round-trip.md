# Copyedit Round Trip (Export → Edit → Import)

Status: Built — all six steps under Unreleased, awaiting copy approval, the 3.10.0 bump and a live check
Created: 2026-09-22
Last Updated: 2026-10-22 (all six steps built, step 5 copy approved)

## Problem

Finished stories are published to AO3 by a single editor (LeeAnn), who runs an
extensive copyedit pass first: whole-work tense normalization, continuity, and
flow. Today that pass happens on the downloaded HTML export, and the result
**never comes back** — there is no import path anywhere in the codebase. The DB
and the Discord thread keep the as-written text permanently, so every published
work is a hand-maintained fork.

The per-entry editor (`story/edit.js`) is correctly shaped for spot fixes and
badly shaped for this. Current backlog: 50k+ words awaiting edit.

## Findings

### Pages are not a real boundary

`chunkEntryContent()` (`utilities.js:384`) splits an entry into 3800-character
pages purely to fit Discord's 4000-character modal cap. `story_entry.content`
is a single `TEXT` column; pages are computed at display time and never stored.

Confirmed with the editor: text routinely moves **across pages within an entry**
during a copyedit, but **not across turn boundaries**. So the page boundaries
that make editing painful are a UI artifact of a Discord limit, and the editor
is currently doing chunking arithmetic by hand to satisfy a constraint the data
model does not have. Entry boundaries, by contrast, are real and stable — which
is what makes a per-entry round trip safe, with no authorship ambiguity.

### Growing an entry is undiscoverable

Within an edit session the chunk list is deliberately frozen — see the comment
at `story/edit.js:638` ("do NOT re-chunk from scratch, as that shifts boundaries
and causes orphaned content"). To add a page you must save and reopen.

Before phase 1, the only in-app hint that this was possible was a
`setPlaceholder()` on the edit modal's content field — on main at
`story/edit.js:418`, reading "N / 3800 on this page of M total. Save and reopen
this page to add more." (hard-coded, which is its own CLAUDE.md problem). A
placeholder renders only when the field is empty, and the `setValue()` beside it
always pre-fills the field, so that hint almost certainly never displayed to
anyone. **Not verified against a live client** — the builder just forwards
`placeholder` to the API and cannot settle a client rendering question, and this
host has no local/staging execution — so it stays a strong suspicion rather than
a fact. It is moot either way now: phase 1 replaced it with a `LabelBuilder`
description above the field (`story/edit.js:513`, config key
`txtEditModalPageHint`), which renders regardless of whether the field is empty.

The observed workaround is padding an entry with junk text to force an extra
page — not something a non-developer would ever discover.

### No attachment handling exists

`addAttachmentOption` / `getAttachment` appear nowhere in the codebase. File
upload is new ground for this bot (supported fine by discord.js).

### Display order has no column — and one was removed, not dropped

`turn` (`db/init.sql:55`) and `story_entry` (`db/init.sql:67`) both lack a sort
column. Display order is derived entirely from `turn.started_at`, which is also the
honest record of *when* the turn happened. Fourteen queries across eleven files
compute a turn number from it, either as the correlated subquery
`COUNT(DISTINCT t2.turn_id) ... WHERE t2.started_at <= t.started_at`
(`story/_exportData.js:33`, `story/close.js:23`, `story/edit.js:81`/`:109`/`:706`/`:741`,
`story/read.js:226`, `story/_manageEntriesList.js:50`, `story/_writeSkip.js:33`,
`story/_writeQuickMode.js:198`, `story/_writeFinalize.js:245`/`:383`,
`commands/_myStoryList.js:425`) or as
`DENSE_RANK() OVER (ORDER BY t.started_at)` (`commands/story.js:524`/`:539`).
`story/_manageTurnActions.js:446` goes the other way and *looks a turn up* by that
computed number. `utilities.js:530`'s `getTurnNumber` is a separate thing — a
`COUNT(...) + 1` next-turn counter, not an ordering.

**`story_entry.order_in_turn` used to exist**, and is the obvious place to look first:

```sql
order_in_turn INT DEFAULT 1,
UNIQUE KEY unique_turn_order (turn_id, order_in_turn)
```

It was removed in `1a8a065` (2026-04, the entry-edit system) along with every query
that read it; `79b1c19` cleaned up an `ORDER BY` left behind. **No migration ever
dropped the column.** It is gone from `init.sql`, so a database created after April
does not have it — but the production database predates that commit and should still
be carrying it, unused, holding the `DEFAULT 1` it was created with. Not verifiable
from a cloud session; needs `SHOW COLUMNS FROM story_entry` on the VM.

Reviving it is still the wrong move. The name scopes order to a turn when what is
needed is story-wide, and `unique_turn_order` constrains `(turn_id, order_in_turn)`,
which is not the uniqueness that matters. Every existing row holds the same default,
so the backfill is identical either way — reuse buys nothing but a misleading name.
**Decided 2026-10-21: drop it rather than edit or repurpose it.** The migration has
to be conditional (`DROP ... IF EXISTS`, the pattern of
`012_drop_additional_tags.sql`), because a post-April database never had the column.
It should also drop `unique_turn_order` explicitly rather than relying on the column
drop: in MySQL and MariaDB, dropping a column that is part of a multi-column index
removes the column *from* the index instead of dropping the index, which would leave
a `UNIQUE KEY` on `turn_id` alone. That constraint would be harmless today (see
below) but is one nobody intended, and leaving it behind for a future session to
puzzle over is worse than one extra line in the migration.

**One `story_entry` row per turn, in every mode.** Worth recording, because it is not
obvious from the schema and an earlier draft of this section got it wrong. Quick mode
is the only path that creates a row before finalize (`story/_writeQuickMode.js:115`,
inserted `pending`), and it then transitions *that same row* in place — `:188` to
`confirmed` on submit, `:269` to `discarded` on discard or timeout — and on a rewrite
after a discard it selects the existing row and updates it (`:103-113`) rather than
inserting a second. Quick mode takes a single input, so there is never more than one.
Thread modes never stage a row at all: `story/_writeFinalize.js:351` inserts straight
to `confirmed`. No code path gives a turn two `story_entry` rows.

So `021_story_entry_confirmed_unique.sql`'s comment that "a turn is expected to carry
other-status rows too" describes what its partial-unique trick *tolerates*, not what
the application actually produces. And an earlier claim here — that production may
have already lost `order_in_turn`, because its `DEFAULT 1` would have collided on any
turn holding a second row — does not hold: no turn ever holds a second row, so no
collision would ever have occurred. Whether the column is still there is simply
unknown, and needs `SHOW COLUMNS FROM story_entry` on the VM.

### Chapters do not exist

Only referenced as a one-line idea in `PLAN-series-system.md` (Status: Idea).
The editor's Google Docs workflow uses one tab per chapter; the bot has no
equivalent, so long works are either split into separate stories up front or
left as one 40k-word story to be divided by hand later.

### Incidental

- ~~`CLAUDE.md` pins discord.js 14.26.4; installed resolves to 14.27.0.~~ Pin updated
  2026-10-21, and the note now also records modal file-upload support.
- ~~Discord's `___text___` (underline + italic) breaks in the HTML export.~~ Fixed
  2026-10-21: a `___(.+?)___` pass now runs before the `__` one, which was taking the
  first two underscores and leaving a stray trailing one. Folded into this batch because
  it affects the round trip — markdown edited in an export file has to render back.
- `story.ao3_URL` stays for now (2026-10-21): a published-URL field may be reimplemented.

## Proposed direction

### Format: plain text with markdown (decided)

**Updated 2026-10-20: the editing surface moved.** It is now VS Code on a laptop,
or a Claude doc with an agent exporting back to HTML from a phone; Google Docs is
out. Plain text still wins, and now for a better reason than tool constraints —
it is the most faithful representation of what is actually stored in
`story_entry.content`, which is what makes it right for a true copyedit. The
original reasoning (raw HTML is unpleasant to hand-edit, and there was no good
phone text editor) is kept below for the record.

The editing surface was Google Docs, largely on a phone. That ruled out raw HTML
(escape characters and tags) and markdown-in-a-text-editor (no good phone
editor).

Inline markdown (`*italic*`, `||spoiler||`, `[[break]]`) appears literally. For
tense/continuity work that is an advantage — what you see is what is stored —
and it round-trips losslessly. `.docx` was considered and rejected: it renders
real formatting in Docs but makes the return trip lossy and adds a dependency.

Where a delimiter is needed (whole-story file only, see phase 2), it should
follow the existing `[[...]]` bot-tag convention rather than inventing a new
one. Verified safe: `applyEntryMarkup` only transforms `[[break]]` and
`[[text|translation]]`, so an unrecognised `[[...]]` passes through untouched.

### HTML as the round-trip carrier: rejected

Asked 2026-10-20 whether the batch path could just take back the HTML the export
already produces, discovering turns from its `turn`-classed wrappers. Structurally
that holds — the export does wrap each turn that way. Rejected anyway:

- Reversing the render needs a second parser. `[[break]]` is emitted as the story's
  divider text, `[[text|translation]]` as a nested tooltip span, and `marked` runs
  with `breaks: true` so single newlines become line-break tags. All reversible,
  all places to silently corrupt prose.
- The export's image URLs are not in the image tags. They are in the JSON block at
  the foot of the file, which the file itself tells the reader not to paste into AO3.
- Any editor that round-trips HTML through its own document model (Google Docs did
  this; an agent re-exporting a Claude doc may too) rewrites the markup, and the two
  things batch import depends on — turn boundaries and image links — are the two
  least likely to survive.

One format for both paths instead: the plain text above, with explicit visible
delimiters. A `[[turn 12 · #4417]]` line is more discoverable than a div wrapper,
not less, and a missing one can be named precisely rather than guessed at. The HTML
export stays what it is: the one-way AO3 publication artifact.

### Images: tokens rejected, and the real gap

An earlier draft proposed replacing each image with an opaque token so Google Docs
could not mangle the URL. **Dropped** — tokens were a defence against a tool no
longer in use, and they would remove the editability that matters more.

The real gap, raised 2026-10-20: there is no way to point an image at an external
host, which is exactly what publishing to AO3 needs. The pipeline is keyed on the
Discord CDN hostname — `ATTACHMENT_URL_REGEX` (`story/_exportImages.js:4`) matches
only `cdn.discordapp.com/attachments/...`, and `export.js` only converts links
matching that same pattern into images. An externally hosted URL in entry content is
not treated as an image anywhere: not in the export, not in the thread display. It
renders as a plain link.

**Decided 2026-10-20: widen the pattern. No images table.** Any https image URL
counts as an image, and a writer adds or changes one by editing the
`[caption](url)` text — including an image that was never in Discord at all, which
is new capability rather than only a fix. The alternative considered and rejected
was storing both URLs (Discord copy for in-server display, optional external URL
preferred by the export) in a small images table; it keeps a safety net nobody had
asked for at the cost of a migration and a second source of truth.

Accepted cost: the media-channel copy is the reliable one because the bot can
re-sign it. An image pointed at an external host has its fate tied to that host.

### External images: uniform treatment is the requirement (decided 2026-10-21)

An external image is presented exactly as a Discord one, everywhere: the same read gallery,
the same download-and-reupload on a thread post, the same download-and-embed in the HTML
export. Only the plumbing differs where it has to — an external URL skips the signature
refresh it has no use for, and an oversize one goes straight to wsrv.nl rather than trying
Discord's media proxy first.

Whether any particular external image actually renders is explicitly **not** a concern. In
the read gallery Discord's proxy fetches the remote host, so a slow or vanished host leaves
an empty embed frame rather than a placeholder, since an image-only embed has no text to
fall back to. Adding a caption to those embeds so a failed load leaves something behind was
offered and declined: uniform handling is the property that matters, not guaranteed display.

### What widening actually touches

The Discord CDN literal is hard-coded in **seven regexes across four files**:

- `_exportImages.js:4` (`ATTACHMENT_URL_REGEX`, used to collect) and `:58`
  (`withFreshAttachmentUrls`'s rewrite)
- `export.js:109` (strips legacy `![](url)`) and `:120` (turns links into images in
  the HTML)
- `_entryRenderer.js:25`, `:28` and `:181` (`IMAGE_LINK_RE`, behind `splitAtImages`)
- `_storyStatus.js:114` (status-embed image)

These should collapse to **one shared exported pattern** rather than seven widened
copies — the same drift that produced `story/read.js`'s stale config-key list and its
duplicate modal.

Three constraints that fall out:

1. **Refresh stays Discord-only.** `refreshAttachmentUrls` posts to Discord's
   `/attachments/refresh-urls`; foreign URLs cannot go in that call. The widened
   collector has to partition — Discord URLs get refreshed, everything else is used
   as-is.
2. **The bot would fetch arbitrary user-supplied URLs.** `fetchImage`
   (`_exportImages.js:63`) is already defensive: a request timeout, a
   `content-type: image/*` check, and both the declared `content-length` and the
   actual buffer measured against `cfgExportImageMaxBytes`. What is *not* covered is
   the destination — today it is always Discord, and after widening any writer could
   point the bot at an internal address, with the response coming back embedded in a
   downloadable export. Worth requiring `https:` and rejecting loopback and
   private-range hosts while the regex is being changed.
3. **It changes existing entries retroactively.** A non-Discord image link in an
   already-written entry renders as a plain link today and would start rendering as
   an embedded image, in exports and in thread reposts. Probably wanted, but it is a
   silent change to published work.

With this decided, the round trip needs no image machinery of its own: real URLs stay
in the body where they can be read and edited.

### Entry ordering: a column of its own (decided 2026-10-21)

The correction that unlocks this: **display order and chronology are different facts,
and only display order moves.** `started_at` stays exactly as it is, so `/mystory
catchup` (`commands/_myStoryList.js:419`, which compares it as a time, not a sort key)
and `PickNextWriter` (`story/_turn.js:27`, which deliberately sorts by the `turn_id`
auto-increment "for reliable sequencing") keep reading the same honest history they
read today. Reordering never rewrites a timestamp. The objection recorded earlier in
this plan — that reordering corrupts turn selection — applied only to reordering *by
moving* `started_at`, and does not apply to a separate column.

Shape:

- **`story_entry.entry_order INT`**, story-wide, added by a conditional migration and
  backfilled from the current `started_at` ordering.
- **Dense `1..n` per story, renumbered on reorder.** An earlier draft proposed sparse
  values with gaps, to avoid renumbering on insert. That was solving a problem that
  does not exist: soft delete keeps the row, so a deleted entry that keeps its
  `entry_order` leaves no hole in the stored sequence, and Restore only flips
  `entry_status` back for the entry to reappear in place. Gaps would only help if
  renumbering were expensive, and at a story's scale — tens to a couple of hundred
  entries, reordered by a rare deliberate admin action — it is one UPDATE inside the
  transaction every story state change already runs in. Dense also gives an invariant
  that can be asserted and eyeballed, where a sparse scheme gives none and drifts
  invisibly.
- Display turn number is a `DENSE_RANK()` over the *confirmed* rows in `entry_order`
  order, not the raw column, so a soft-deleted entry holding its slot does not leave a
  hole in the numbering readers see.
- **Restore puts an entry back in its old slot, and the one rule that makes that work is
  that a renumber carries soft-deleted rows too** (decided 2026-10-21). A reorder
  renumbers every row of the story, deleted ones included — not just the confirmed ones.
  Skip them and a deleted row's stale value collides with a live one: positions 1-5,
  delete #3 (it keeps 3), then move #5 to the front, and the confirmed rows renumber 1-4
  while a deleted row still holds 3. Carried through the renumber, "it holds its slot"
  stays true across any number of reorders, Restore stays a pure `entry_status` flip with
  no ordering logic in it at all, and the entry comes back where it was *relative to
  whatever its neighbours have become* — which is the requirement: if other entries
  shifted around it, we do not try to second-guess that. A newly written entry takes
  `MAX(entry_order) + 1` over all statuses, so it can never land on a held slot. The
  alternative considered and rejected is storing a neighbour anchor ("restore after entry
  #X"), which is the second-guessing, and breaks when the anchor is itself deleted.
- Note that `story_entry` has no `story_id` — it reaches the story via
  `turn.story_writer_id` -> `story_writer.story_id`. Per-story uniqueness or contiguity
  is therefore not expressible as a schema constraint without denormalising, and is
  application-enforced under either scheme.
- **Turn number follows display order**, not chronology. The published work prints it
  at each turn break beside the author name, so a shuffled sequence there is the
  confusing outcome. Stale turn references in older Discord posts are accepted:
  whoever reordered the story knows why the numbers moved.

**Exactly which queries change.** The distinction that matters is what a given
`started_at` reference is *for*. Sorting a list for display changes; asking which turn
happened most recently does not.

*Switches to `entry_order` — turn numbering (15 lines, 12 files).* The correlated
subquery `COUNT(DISTINCT t2.turn_id) ... WHERE t2.started_at <= t.started_at`:
`story/_writeSkip.js:33`, `story/close.js:23`, `story/_manageEntriesList.js:50`,
`story/edit.js:81`/`:109`/`:706`/`:741`, `story/read.js:226`,
`story/_writeQuickMode.js:198`, `story/_exportData.js:33`,
`commands/_myStoryList.js:425`. Plus two variants: `story/_writeFinalize.js:245` uses
`< ... + 1` for the number a new turn is about to get, and
`story/_manageTurnActions.js:446` runs it backwards, looking a turn *up* by its number.
And the `DENSE_RANK() OVER (ORDER BY t.started_at)` pair in `commands/story.js:524`/`:539`
(the turn autocomplete), which is the shape the correlated subqueries should converge on.

*Switches to `entry_order` — display sequence.* `ORDER BY t.started_at` ascending, where
the result is a list someone reads: `story/read.js:232`, `story/_exportData.js:38`,
`story/_manageEntriesList.js:64`, `commands/_myStoryList.js:430`, and
`story/close.js:28` (stats only, so order is immaterial, but leaving one query sorted
the old way is how the two orderings drift apart again).

*Stays on `started_at` — genuinely chronological.* Every `ORDER BY t.started_at DESC
LIMIT 1` asking "which turn is current or just ended": `story/_writeSkip.js:39`,
`story/close.js:121`, `story/_manageClose.js:52`, `story/_turn.js:741`,
`announcements.js:30`/`:208`, `commands/_myStoryList.js:411-415`. Also the catchup time
comparison at `commands/_myStoryList.js:419`/`:429`, which uses `started_at` as a
timestamp rather than a sort key, and `story/_turn.js:27`'s `PickNextWriter`, which sorts
by `turn_id` for the same reason.

*Needs a look, not a mechanical change.* `utilities.js:530`'s `getTurnNumber` is a
`COUNT(DISTINCT t.turn_id) + 1` next-number counter rather than an ordering. Dense
`1..n` keeps it correct, but it should be read against the new scheme rather than assumed.
- **The export delimiter does not change.** `[[turn N | #id | writer]]` already carries
  identity in `#id` and treats the turn number as display, so renumbering under a
  reorder costs nothing in the file format.

**Why the column belongs on `story_entry` and not on `turn`.** First, because a turn
row can exist with no entry at all: `story/_writeSkip.js` contains no insert into
`story_entry`, and `TURN_STATUS` holds only `ENDED` and `ACTIVE` (`constants.js:14`),
so a skipped or timed-out turn is simply an ended turn that produced nothing. Order on
`turn` would hand slots to turns that contribute nothing to the story and need
filtering back out. The existing numbering subqueries already do exactly that
filtering — each joins `story_entry` on `entry_status = confirmed` — so turn numbering
has always been entry-driven in effect, and merely *sorted* by `turn.started_at`.
Putting the column on `story_entry` makes the schema say what the code already computes.

Second, a per-entry order would normally risk splitting a turn — interleave another turn's entry between two of turn
12's and "turn 12" appears twice with turn 13 between them. That cannot happen here:
`021_story_entry_confirmed_unique.sql` enforces **one confirmed entry per turn** via a
generated `confirmed_turn_id` column and a unique key on it. A turn carries at most one
confirmed row, so ordering confirmed entries *is* ordering turns, and no contiguity
invariant is needed.

**Correction to phase 2's shipped text.** ~~`story/_exportText.js` and the Unreleased
changelog entry both justify matching on the entry id by claiming a turn can hold more
than one confirmed entry.~~ **Done 2026-10-22.** Both now give the real reason: the turn
number is a display number computed from `entry_order`, so it changes under a reorder,
and once import can reorder, the file's turn numbers are input for the new order rather
than identity. The entry id is the only part of that line that never changes.

### Reassignment, reordering, and the change log (decided 2026-10-21)

Reassigning a turn is one column: `UPDATE turn SET story_writer_id = ?`, pointing at the
`story_writer` row for another member of the same story. `story_writer` carries
`UNIQUE KEY (story_id, discord_user_id)`, so there is exactly one row per person per
story and no ambiguity about the target; someone who left and rejoined is that same row
with `sw_status` flipped. `pen_name` lives on that row and every display query resolves
the name through the join, so the export, status post and thread all follow the change
with no denormalised copy to chase. Nothing writes `turn.story_writer_id` today — every
reference in the codebase is a JOIN — so this is new behaviour with nothing to
coordinate against.

Two cautions. `PickNextWriter` decides who is up by reading the most recent turn's
`story_writer_id` (`story/_turn.js:27-32`), so reassigning a *past* turn is inert while
reassigning the latest one shifts the rotation — wanted for fairness, but it should not
be a surprise. And `turn.thread_id` keeps pointing at the original writer's turn thread,
which is harmless since those are cleaned up.

**Both changes are audited in `story_entry_edit`, which becomes a per-entry event log.**
Not a column on `turn`: a single `original_story_writer_id` would record the first
author and silently swallow the hops, where a row per change preserves a
Maria -> Jun -> Maria chain with who made each change and when. The table is already the
audit trail, already surfaced in the history panel, and already denormalises a name
(`edited_by_name`) so history survives.

Schema changes:

- `content` becomes nullable — a reorder or reassignment row has no content to snapshot.
- `change_type` nullable, the discriminator. `change_type IS NULL` is a content version.
- previous and new writer (id plus a name snapshot, mirroring `edited_by`/`edited_by_name`),
  and previous and new position.
- **Both sides of the change on the row, not just the previous value.** The history panel
  pages one row at a time (`story/_editHistory.js:15`, `LIMIT 1 OFFSET ?`), so whatever is
  on the row is all it has to render with. Store only the previous writer and showing
  "Maria -> Jun" means fetching a neighbour, or the turn itself for the newest row.
- Typed columns rather than a `detail JSON` like `guild_event` has. Three stable change
  types, the panel reads these rows on every page turn, and mysql2's switch to returning
  MariaDB JSON as objects already took out every job once (PR #87). Not worth inviting
  back into a read path.

**Rejected: encoding the change as a marker inside `content`.** Attractive because it
needs no migration, and it was pursued as far as a `[[reassign|<from>|<to>]]` pattern with
a build/parse pair mirroring `story/_exportText.js`. It does not survive contact with the
existing markup. `[[break]]` is safe — `isSceneBreakLine` (`story/_entryMarkup.js:83`) is
an exact full-line match with no pipe. But `TOOLTIP_RE` (`:16`) is
`/\[\[([^[\]\n|]*)\|([^[\]\n]*)\]\]/g`: the first group excludes pipes and the second does
not, so `[[reassign|123|456]]` matches it as text `reassign`, translation `123|456`
(verified by running it). An internal marker in that namespace is not merely *mistakable*
for a translation tag, it *is* one, and the history panel rendering content is exactly a
render path. A `!` prefix does not escape it either, since `!` is not an excluded
character. Generally: `[[...]]` is the user's markup namespace and `content` is free text
they control, so no in-content marker can be made collision-proof, only improbable — and
these rows are user-facing, so a marker that renders as a tooltip is a visible bug.

**Restore must refuse non-content rows.** `story/_editHistory.js:113` reads `content` from
the chosen row and `:137` writes it into `story_entry`, so without a discriminator a
Restore on an audit row would overwrite an entry with a log marker. With the column the
dangerous case is unreachable rather than carefully handled.

**Log intent, not consequence.** `entry_order` is dense, so moving one entry rewrites the
position of every entry after it. Logging each would write ~30 rows for a single move in a
40-turn story, 29 of them entries that merely shifted to make room, burying the real
content history. One row records the deliberate move; the incidental renumbering is
derivable.

**These rows are user-facing**, so they need config strings rather than stored prose —
provisionally `txtEditHistoryReassigned` and `txtEditHistoryReordered`, with
`[from_writer]`/`[to_writer]` and `[from_position]`/`[to_position]` tokens through
`replaceTemplateVariables`. Wording needs approval before it ships.

### Import flow

Phase 1 is a **single-entry** round trip on the existing edit interface: download
this entry as text, fix it wholesale with no page boundaries, upload it back.
This is the smallest change that removes the page problem entirely, its diff
fits Discord's limits comfortably, its permission model is already solved by the
edit panel's existing author/admin/creator gate, and it needs no delimiters at
all — the file is just that one entry. It also builds every piece the
whole-story version needs, so it is a stepping stone rather than throwaway work.

Phase 2 generalises the same machinery to a whole-story file.

1. Attachment upload (admin/creator gated; single-entry reuses the edit gate).
2. Parse, match blocks by entry ID, compute a per-entry diff.
3. Preview: entries changed / unchanged / missing markers. Nothing commits yet.
   Embed descriptions cap at 4096 characters (verified in the installed
   builders), so a full inline diff is not viable for anything large — the diff
   should be posted as an **attached file**, reusing the mechanism `export.js`
   already uses to attach HTML, with only a compact summary in the message.
4. On confirm, one transaction — per changed entry, `INSERT` the old content
   into `story_entry_edit` (preserving existing history semantics) then `UPDATE`
   `story_entry.content`.
5. Optionally re-post affected thread messages via the existing
   `postThreadEntry` / repost mechanism.

Because edits stay within entry boundaries, every block maps 1:1 and the
authorship ambiguity that would make this risky does not arise.

### Import instructions (replaces the "leave those lines alone" paragraph)

The legend shipped in phase 2 tells the reader not to reorder or remove anything.
That is accurate only until import lands; afterwards the same paragraph becomes
instructions for doing exactly those things. What it has to convey, inside the file:

- The `[[turn N | #id | writer]]` line identifies the entry. `#id` is the identity and
  must survive unchanged; the turn number and writer name are display values and are
  recomputed on import.
- **Reorder** by moving a whole entry block — delimiter and prose together — to its new
  position. The file's own order becomes the story's order.
- **Reassign** by changing the writer name in the delimiter to another writer already
  joined to the story.
- **Remove** by deleting the entry's whole block. This is a soft delete, restorable
  from Manage Entries, and the entry returns to the position it held.

Outside the file, on apply: the import reports what it is about to do — "3 entries
reordered, 1 reassigned, 1 removed" — and waits for a confirm. That is what makes
removal-by-omission safe to allow. An accidental drop during a copyedit is restorable
either way, but the confirm means most accidents never need restoring.

Copy is not drafted here on purpose. It should be written against the real mechanics
once they exist, not guessed at now, and like all user-facing text it needs approval
before it ships.

### Import confirmation (decided 2026-10-21)

No full diff. The editor made the edits and does not need them read back; the confirm
exists to surface what they could *not* have intended. One row per turn, which absorbs
the categories instead of splitting them into separate lists:

`12. Maria - 1,420 -> 1,380 words (moved to 9)`

A removal reads as `-> removed` on the line where that turn belongs, a reassignment is
the writer name changing on the line, and a conflict — an entry edited in Discord between
export and import, the one item in the summary the editor cannot know about — is a marker
on the line. Listing removals individually rather than counting them is also the
truncation safeguard: a phone editor that eats the tail of the file arrives as a list of
entries the editor recognises, which is alarming in a way "9 removed" is not.

Only changed turns are listed, finishing with a count of the rest ("28 unchanged"), since
the signal is what moved. At roughly forty characters a line, about a hundred turns fit an
embed description; when the changed list overflows, show the first stretch inline and
attach the full summary as a `.txt`, reusing the attachment pattern the exports already
use rather than building another paginated panel.

An entry id that is not in this story, or the same id twice, is not a confirmation case —
that is a wrong or mangled file, and it refuses with a reason rather than offering a
summary to approve.

Conflict detection needs the export's timestamp at full precision. The header currently
stamps the day only (`story/_exportText.js`, `.toISOString().slice(0, 10)`), where the
check wants the instant, comparing against `story_entry_edit.edited_at`. Cheap to change
now and awkward once files are in flight that the parser has to keep accepting.

The flow needs no slash command with an attachment option: modals take file uploads in
discord.js 14.27.0 (`FileUploadBuilder`, `ModalSubmitFields.getUploadedFiles()`, and
`docs/reference/discordjs_reference.md:149`), so it is a button on the edit panel, a modal
that takes the file, the ephemeral confirm, then apply.

### Chapters: a real UI, not file markers (revised)

An earlier draft proposed defining chapters with markers inside the imported
file. **Rejected** — a text file gives no validation, no preview and no undo
affordance for a change to story-level structure, and an import should not be
able to silently rewrite story-level DB values as a side effect of a copyedit.

Preferred shape instead: an explicit chapter interface, along the lines of a
print-range dialog — "add a chapter", then a comma-delimited list or range of
turns (`1-4, 7`), plus optional title and summary, since AO3 chapters carry
both. Compact enough for a Discord modal and no file parsing involved.

Needs a `chapter` table (story_id, position, title, summary) and a turn
association. Design consideration: ranges are positional, so if turn reordering
(below) ever lands, chapter ranges need to move with it or be stored as
explicit turn references rather than numeric ranges.

## Build order

Sequence set by LeeAnn on 2026-10-21; this is the order to build in, not a menu.

1. ~~**Small** — an explicit "Add a page" button on the edit panel, plus
   `LabelBuilder.setDescription()` to make the save-and-reopen behaviour visible.~~
   **Built 2026-10-20**, held under Unreleased for the 3.10.0 bump. Also folded in:
   the hard-coded strings in the files it touched moved to config, `story/read.js`'s
   duplicate copy of the same modal consolidated onto the shared builder, and its
   stale copy of the config-key list replaced with the exported
   `EDIT_PANEL_CONFIG_KEYS`. See the Unreleased changelog entry.
2. ~~**Small/medium** — the plain-text "Export Entries for Editing" file: header,
   legend, `[[turn N | #id | writer]]` delimiters, the `[[exported-at]]` trailer, and
   the image-pattern widening that came with it.~~ **Built 2026-10-21**, also under
   Unreleased.
3. ~~**Medium** — the `entry_order` migration.~~ **Built 2026-10-22**, under Unreleased:
   migration 026 adds and backfills the column, drops `order_in_turn` with its index, and
   `story/_entryOrder.js` now holds the numbering subquery, the display sort and the
   next-order helpers that the fifteen numbering queries and five display sorts call. The
   original description follows. Add the column and backfill it from the
   current `started_at` ordering; drop `order_in_turn` **and its `unique_turn_order`
   index explicitly first**, with `IF EXISTS` guards; then switch the fifteen
   turn-numbering lines and the five display sorts over. See "Exactly which queries
   change" for the inventory. Prerequisite for everything below it, because both
   reordering in the panel and reorder/remove semantics on import need a column to
   write to.
4. ~~**Small/medium** — reorder and writer-change in Manage Entries, **with the change
   log in the same piece of work**.~~ **Built 2026-10-22**, under Unreleased. Migration 027
   turns `story_entry_edit` into a per-entry event log (`change_type`, both writers, both
   positions, `content` nullable); `moveEntryToPosition` in `story/_entryOrder.js` is the
   renumber, shifting one side of the displaced range across every status so a soft-deleted
   entry travels with its neighbours; `story/_entryChangeLog.js` writes the non-content rows
   and lists the picker's candidates; `story/edit.js` carries the two buttons (disabled on a
   deleted entry), the move modal, the writer picker with its latest-turn note, and both
   apply paths; `story/_editHistory.js` branches per row type with Restore disabled on a
   change row, and the restore execution refuses a non-content row. The approved copy below
   landed as written. The original description follows. The move is `entry_order` plus a
   renumber that carries soft-deleted rows; the
   writer change is `turn.story_writer_id` pointed at another `story_writer` row of
   the same story, with no ordering involved. Delete and Restore already exist
   (`story/edit.js:401`). The change log is `story_entry_edit` gaining `change_type`
   and the previous/new columns, `content` going nullable, the history panel branching
   per row type, and Restore refusing non-content rows.
5. ~~**Small/medium** — single-entry export + import on the edit panel.~~ **Built 2026-10-22**,
   under Unreleased, in `story/_editFileRoundTrip.js`. Two buttons, settled by her argument
   against the one-button framing (an interaction token on the download message is dead long
   before the file comes back). The file is this plan's format narrowed to one entry; the id in
   the delimiter is what powers the wrong-file and stale-file checks; the confirm states the word
   count either side and names the file; the apply writes the history row before the content, the
   same order the modal save uses. **Copy approved 2026-10-22** -- Export/Import rather than
   Download/Upload, one message for both first-line failures, the existing Save button, and no
   Cancel; two strings in the set are still mine. See the approved-copy section below. The original description follows.
   The real fix for cross-page editing. Main open question is how to present it: framing it as
   one round trip ("edit as file") likely reads more clearly than two separate download/upload
   buttons.
6. ~~**Medium** — whole-story import with the per-turn confirm.~~ **Built 2026-10-22**, under
   Unreleased, as `story/_importPlan.js` (pure: the file plus a snapshot in, a plan or a refusal
   out) and `story/_importStory.js` (the upload, the confirm, the apply). Entry point is a button
   on the admin Manage Entries picker, since it acts on every entry at once. Decided while
   building, both following the plan's own rules rather than extending them: a block for a
   currently-deleted entry brings it back, because the file is the story and it is in the file;
   and an entry the file leaves out keeps its slot between the turns it sat between, rather than
   moving to the end, so Restore returns it where it belongs. Copy is **drafted, awaiting
   approval**. The original description follows. Generalises (5)'s
   machinery over the file (2) already produces.

Chapters and per-chapter export are deliberately **not** in this list — they are 4.0
work, coordinated with `PLAN-series-system.md`. See the release-shape entry under
Settled.

## Approved copy — Change Order, Change Writer, and the change log

Approved by LeeAnn 2026-10-21. These are the exact values to land when step 4 builds; they
go into `db/config_files/config_storyadmin.sql` (the Manage Entries keys) and
`config_turn.sql` (the history keys), and into `docs/reference/config_roadmap.md`. They are
deliberately **not** synced ahead of the build — an unused key in the DB is noise.

**Change Order** — the move modal on the per-entry panel.

| Key | Value |
| --- | --- |
| `btnManageEntriesChangeOrder` | Change Order |
| `txtManageEntriesChangeOrderModalTitle` | Change Order |
| `lblManageEntriesChangeOrderTurn` | Move to turn number (1-[total]) |
| `txtManageEntriesChangeOrderPlaceholder` | e.g. 4 |
| `txtManageEntriesChangeOrderSuccess` | ✅ Moved to turn [to_position]. The turns in between have been renumbered. |
| `txtManageEntriesChangeOrderInvalid` | ❌ Enter a turn number between 1 and [total]. |
| `txtManageEntriesChangeOrderNoChange` | ❌ This entry is already turn [to_position]. |

**Change Writer** — the writer picker, delivered as a follow-up select like Manage Turns'
next-writer flow, so it costs no row on the panel.

| Key | Value |
| --- | --- |
| `btnManageEntriesChangeWriter` | Change Writer |
| `txtManageEntriesChangeWriterSelect` | Who should turn [turn_number] belong to? |
| `txtManageEntriesChangeWriterPlaceholder` | Select a writer... |
| `txtManageEntriesChangeWriterSuccess` | ✅ Turn [turn_number] now belongs to **[to_writer]** (was [from_writer]). |
| `txtManageEntriesChangeWriterSame` | ❌ This entry already belongs to [to_writer]. |
| `txtManageEntriesChangeWriterLatest` | -# This is the most recent turn, so changing its writer also changes whose turn comes next. |

The picker lists **everyone ever joined to the story**, any `sw_status`, not just active
members: crediting an entry is not about who can write next, and it matches the export
header's writer list.

**The change log**, rendered in the History panel.

| Key | Value |
| --- | --- |
| `txtEditHistoryWriterChanged` | Writer changed from **[from_writer]** to **[to_writer]**. |
| `txtEditHistoryMoved` | Moved from turn [from_position] to turn [to_position]. |
| `txtEditHistoryChangeTitle` | Entry History - Change [version] of [total] |
| `txtEditHistoryChangeBy` | Changed by [edited_by] · [edited_at] |

A change row needs no string of its own: the Restore button is **disabled** rather than
replaced by a message (LeeAnn, 2026-10-21). A drafted `txtEditHistoryNoRestore` was dropped
with it, as were the Undo strings — see Settled.

**As built (2026-10-22).** Everything above landed as written, with the em-dash that the
shipped version title already uses, so the two titles read "Edit History — Version 3 of 5"
and "Entry History — Change 3 of 5". Two more strings came along with them, moved out of
inline template literals in `story/_editHistory.js` at their shipped wording:
`txtEditHistoryVersionTitle` ("Edit History — Version [version] of [total]{? · Page [page] of
[pages]?}") and `txtEditHistoryEditedBy` ("Edited by [edited_by] · [edited_at]"). The same
file was also hardcoding the two restore warnings that already existed in config as
`txtEditRestoreWarning{Multi,Single}`; it now reads the keys.

One case has no approved string and reuses one: a story whose only writer is the entry's
current writer has nobody to offer in the picker, so Change Writer answers with
`txtManageEntriesChangeWriterSame` ("This entry already belongs to [to_writer]"), which is
true but was written for a different path. Worth a string of its own if it ever reads wrong.

### Approved copy — the single-entry file round trip (step 5, 2026-10-22)

LeeAnn's wording, approved 2026-10-22. Two of her decisions shaped the set beyond the strings
themselves:

- **Export and Import, not Download and Upload.** "Why is it download and upload when we've been
  saying import and export this whole time?" The buttons also name the *entry*, not the turn,
  because they act on its content -- the numbered thing inside the copy is still a turn, per the
  rule she set the same day.
- **No Cancel button.** The whole flow is ephemeral, so dismissing the message is the way out.
  The confirm's button reuses `btnAdminConfigSave` ("✅ Save Changes") rather than adding another
  key that says Save.

| Key | Value |
| --- | --- |
| `btnEditExportFile` | 📤 Export for Editing |
| `btnEditImportFile` | 📥 Import Edited Entry |
| `txtEditImportModalTitle` | Import Edited Entry |
| `txtEditImportModalHint` | Upload your edited text file. Ensure the first line of the file has the correct turn ID:  `[export_header]` |
| `txtEditImportConfirm` | Your edits will change turn [turn_id] from [from_words] to [to_words] words. After saving, this edit can be reverted from the turn's History. |
| `txtEditImportConflict` | The entry has been edited since this export was saved. Do you want to continue? |
| `txtEditImportNoChange` | No changes were detected or applied. |
| `txtEditImportError` | Turn ID Mismatch: The file does not match the current turn. The first line of the file must read `[export_header]` to match the current turn. |
| `txtEditExportFileInstructions` | (her 2026-10-21 wording, unchanged) |

`[export_header]` is the entry's own turn line, read fresh and rendered exactly as the export
file carries it (`[[turn 12 | #4417 | Maria]]`, or without the name when `show_authors` is off),
so the editor can compare it against the file in front of them. It is deliberately the same
token in the modal hint and in the mismatch message.

`txtEditImportError` replaced two separate strings at her instruction: a file for another entry
and a file with no turn line at all both mean the first line is wrong, and the fix is the same.
`btnEditImportConfirm` was dropped with the Save reuse, and `txtEditImportWrongEntry` /
`txtEditImportUnreadable` with the merge.

**Still drafted in this set:** `txtEditImportConfirmTitle` ("Import Edited Entry", the
confirmation embed's title, mirroring the modal) and `lblEditImportFile` ("Your edited text
file", the label on the file field *inside* the modal, under the hint). `txtEditImportTooLarge`
is also still mine; the limit it quotes is about 65,000 characters, which is what
`story_entry.content`'s `TEXT` column holds (65,535 bytes, measured in bytes because a
non-Latin script would otherwise pass the check and be truncated).

**Open question from her, unanswered as of this writing:** whether
`txtEditImportConfirm` should say where History is reached. It is the **History** button on the
same edit panel the confirmation is sitting on top of.

### Drafted copy — the whole-story import (step 6, 2026-10-22)

**Not approved.** In `config_storyadmin.sql` so the code runs on the branch. The Export/Import
naming and the dropped Cancel button from step 5's review are already applied here; the strings
themselves are still mine.

| Key | Drafted value |
| --- | --- |
| `btnManageEntriesImport` | 📥 Import Edited Story |
| `txtImportStoryModalTitle` | Import Edited Story |
| `lblImportStoryFile` | Your edited text file |
| `txtImportStoryModalHint` | Upload your edited text file. Keep each turn line, the one with the turn ID, exactly as it is. |
| `txtImportStoryConfirmTitle` | Apply this file to the story? |
| `txtImportStoryConfirm` | [changed_count] turn(s) would change, from **[filename]**. The current text of each one is saved to its history first, so you can put any of them back from Manage Entries. |
| `txtImportStoryRow` | [turn_number]. [writer_name] — [from_words] to [to_words] words{? ([notes])?} |
| `txtImportStoryNoteMoved` | moved to turn [to_position] |
| `txtImportStoryNoteWriter` | now [to_writer] |
| `txtImportStoryNoteRemoved` | removed |
| `txtImportStoryNoteRestored` | restored |
| `txtImportStoryNoteConflict` | also edited in Discord since your download |
| `txtImportStoryUnchangedCount` | [unchanged_count] turn(s) stay as they are. |
| `txtImportStoryOverflow` | The full list is attached. |
| `btnImportStoryConfirm` | Apply These Changes |
| `txtImportStorySuccess` | ✅ Story updated from your file: [changed_count] turn(s) changed. |
| `txtImportStoryNoChange` | That file matches the story exactly as it is now, so nothing changed. |
| `txtImportStoryUnreadable` | ❌ That file has no turn lines like [[turn 12 \| #4417]] in it, so there is nothing to match it to. Upload the file you exported for editing. |
| `txtImportStoryUnknownEntry` | ❌ That file has a turn line with ID [file_id], which is not a turn in this story. Export the story again and edit that file. |
| `txtImportStoryDuplicateEntry` | ❌ That file has turn ID [file_id] in it twice. Each turn can only appear once, so one of them needs deleting. |
| `txtImportStoryUnknownWriter` | ❌ "[writer_name]" on turn [file_turn] is not a writer in this story. Use the name of a writer who has already joined. |
| `txtImportStoryEmptyEntry` | ❌ Turn [file_turn] has no text left in it. To remove a turn, delete its whole block including the turn line. |
| `txtImportStoryEntryTooLarge` | ❌ Turn [file_turn] is too long to store. The limit is about [limit] characters per turn. |

**The legend inside the export file is now out of date.** It still says "Do not renumber them,
merge two entries into one, or reorder them", which was true until this step landed. The
replacement is specified under "Import instructions" above and needs writing in her voice:
reorder by moving a whole block, reassign by changing the name in the turn line, remove by
deleting the whole block, and the `#id` must survive unchanged.

### Export and import copy, and the filename (2026-10-21)

**`txtExportTextFooter` is removed.** It reprinted the entry count as the file's last human
line. Its only real job was proving the file wasn't truncated, and the `[[exported-at]]`
trailer that follows it does that for the importer, so it told the reader only that they had
reached the end of the file they were looking at. Removing it touches `_exportText.js`, the
config file and one test.

**The single-entry download message, in LeeAnn's own words** (2026-10-21), so it ships as
written:

> Download the text of turn [turn_number] ([word_count] words) for editing. This is the raw
> text of the entry, so keep any formatting markdown intact. Do not remove the first line,
> which contains the internal turn ID, so that the entry can be imported correctly.

**"Turn", not "entry", wherever user-facing copy refers to the numbered thing** (LeeAnn,
2026-10-22 — she changed her own draft's "entry [turn_number]" to "turn [turn_number]"). The
number *is* a turn number, and the file's first line reads `[[turn 12 | #4417 | Maria]]`.
"Entry" stays correct as the noun for the thing itself, which is why "Delete Entry" and
"Entry deleted" are right as they stand; the rule is about the number.

That copy fixes the shape of the single-entry file: the `[[turn N | #id | writer]]` delimiter
is its **first line**, with no title-and-counts header of its own, then the prose, then the
`[[exported-at]]` trailer. An earlier draft of this plan said a single-entry file needs no
delimiter at all. That is wrong, and the reason is hers: the gap between export and import is
"several minutes, if not hours or days", so the wrong-file and stale-file checks are not
theoretical, and both need the id.

**Filename convention**, for both exports. Today both are
`storybot<story_id>_<title>.{html,txt}` where the title has every non-alphanumeric character
replaced by `_`. Three changes:

- **Use the story number the user sees** (`guild_story_id`), not the internal `story_id`. The
  current number matches nothing visible in the UI. This changes a production filename, so it
  needs to land deliberately.
- **Sanitize only what has to go** — `\ / : * ? " < > |`, control characters, and leading or
  trailing dots — collapsing runs of whitespace to one underscore. The current pattern mangles
  ordinary titles: "The Dragon's Keep (Part 2)" becomes `the_dragon_s_keep__part_2_`.
- **Add the export date and time**, UTC on a 24-hour clock, because downloading the same story
  twice otherwise leaves `(1)` and `(2)` in a downloads folder with nothing to tell them apart.
  **No colon and no `Z` suffix**: a colon is forbidden in Windows filenames and historically
  bad on macOS, and the `Z` is jargon to almost everyone (her call — "a four digit timestamp is
  either nonsense or perfectly logical to users, that's fine").
- **Truncate the sanitized title at 60 characters**, trailing underscore trimmed, no ellipsis.

Giving: `storybot3_a_test_story_entries_2026-10-21_2348.txt` and, for one entry,
`storybot3_a_test_story_turn12_2026-10-21_2348.txt`.

**Still unapproved** as of 2026-10-21: `txtExportTextNoEntries`, `btnEditAddPage`, and the
wording of `txtEditModalPageHint`. On the hint, her objection stands — a modal's contents only
reach the bot on submit, so Add Page being a panel button means unsaved typing is lost, and
"Save any changes before adding a page" says that where "Save, then use Add Page" buried it.
The open question is only whether the string also names the button.

**Three existing strings come into config with this work, wording unchanged.** They are
hard-coded in `story/_editHistory.js` today (the panel title, the footer, and the restore
warning field). Once a row can be a change rather than a version the title has to branch,
so they cannot stay inline. Her current words are preserved verbatim; only the home moves:

- `txtEditHistoryVersionTitle` - `Edit History — Version [version] of [total]{? · Page [page] of [pages]?}`
- `txtEditHistoryEditedBy` - `Edited by [edited_by] · [edited_at]`
- `txtEditHistoryRestoreNotice` / `...RestoreNoticeMulti` - the two forms of
  "*Restoring will replace your entire current entry and will alter the story's turn
  count.*", the second prefixed with "*This version spans multiple pages.*"

Rejected label: **Reassign** for the entry action. Manage Turns already uses it for handing
the current turn back to the previous writer, which is a different operation, and "Reassign
Entry" leaves open whether the new writer gets to rewrite it. Change Order and Change Writer
read as a pair, and the modal carries the detail.

**Manage Turns keeps "↩️ Reassign to Previous" unchanged** (LeeAnn, 2026-10-21). Renaming it
was offered and declined: the label plus its confirm text ("They will get a new turn
immediately, then [current_writer] will go next") already says what it does, and the only
problem it ever had was ambiguity against a second "reassign", which Change Writer removes.

## Open decisions

- How to present the single-entry round trip so it is obvious to a non-developer.
- Whether chapters belong in this plan or in `PLAN-series-system.md`.
- Whether the whole-story import (phase 3) is needed at all once phase 2 exists.
- Whether `order_in_turn` is actually still present in production — needs
  `SHOW COLUMNS FROM story_entry` on the VM. No inference from the application's
  behaviour settles it; the migration is safe either way.

## Settled

- Plain text with markdown, not `.docx`, and not HTML as the round-trip carrier.
- The whole editing revamp ships as one MINOR bump, 3.10.0; steps toward it land
  under Unreleased rather than moving the number each time.
- No image tokens, and no images table. Real URLs stay in the body where they can
  be edited, and the image pattern widens to accept any https image URL.
- Chapters get a real interface; import files do not change *story-level* values
  (title, summary, chapters). Entry-level structure is a different matter — see the
  next entry.
- Turn reordering **is** done by moving blocks in a file, reversing an earlier entry
  here. Structure changes ride the import because the file is where the editing
  happens; the confirm-on-apply step and the existing Restore cover the accident case.
- Display order lives in a new `story_entry.entry_order`, dense `1..n` per story and
  renumbered on reorder; `started_at` is left alone as
  the record of when things happened.
- Turn numbers follow display order and renumber on reorder. Stale references in older
  Discord posts are an accepted cost.
- The old `order_in_turn` column is dropped, not repurposed.
- Reordering and reassignment are audited in `story_entry_edit` as a per-entry event
  log, discriminated by a `change_type` column rather than a marker inside `content`.
- The import confirm is a per-turn summary, not a diff.
- **The change log is read-only history. There is no Undo button** (LeeAnn, 2026-10-21):
  "rather than undo a move or writer change, you'd just change it again", and
  **undo exists only for bringing back a deleted entry.** An Undo on a change row was
  drafted and dropped. The line that settles it: a structural change is never undone, it is
  set again, with the same button that set it — putting an entry back at turn 4 or back with
  Maria is just Change Order or Change Writer, so a second button for it would be a second
  path to one operation. Existence and content each have a restore already; structure has
  none and needs none. This is also what `story/_editHistory.js`'s Restore must refuse to
  act on, which the `change_type` discriminator already gives us. The three behaviours in
  full:
  - **Restore Entry** (Manage Entries) un-deletes: content comes back untouched, because
    delete only flips `entry_status`, and position comes back because the renumber carries
    deleted rows. Both for free, no new code.
  - **Restore This Version** (History) replaces content from a saved version and never
    moves the entry — position is not part of a content version, and keeping the two axes
    independent is what makes either predictable.
  - **A change row** disables the Restore button (her call, 2026-10-21) instead of printing
    an explanation. The page already says which kind it is — "Entry History - Change 3 of 7"
    over a line reading "Writer changed from Maria to Jun" — so a message would restate it,
    and `setDisabled` is how this same panel already handles Delete and Restore in manage
    mode. Note the existing code *omits* the Restore button on the later pages of a
    multi-page version rather than disabling it (`story/_editHistory.js`, the
    `histChunkPage === 0` guard); left as it is, not matched, unless she asks.
- **Change Order and Change Writer live on the existing per-entry panel** (2026-10-21), the
  classic message you reach through Manage Entries on the V2 Story Manage panel, beside the
  Delete and Restore buttons that are already there. Both act on the one entry just selected,
  and the V2-to-classic hop is what that button already does today. A Manage Entries panel of
  its own was considered and is not needed: worst case that panel uses four of Discord's five
  action rows — page-jump select, the five-button nav row, Delete/Restore, Back to List — so
  the two new buttons take the admin row to four of five with a row still spare. Revisit the
  separate panel when the single-entry round trip adds its buttons in step 5, not before.
  Note the installed builders validate no component counts at all, so an over-budget payload
  fails at send time rather than at build time.
- Button labels **Change Order** and **Change Writer**, approved 2026-10-21. "Reassign" was
  rejected for the entry action because Manage Turns already uses it for handing the current
  turn back to the previous writer; the two read as a pair, and the modal carries the detail.
- Reassign ships inside 3.10.0, as part of the edit import (2026-10-21) — it is a
  structure change made in the file alongside reordering, not a separate later feature.
- The plain-text export header credits **everyone who has an entry in the work**, in
  order of their first one (2026-10-21), taken from the entries rather than from the
  active-writer list: a writer who has since left still wrote prose the editor is about
  to touch, and a member who joined but never wrote is not an author of it.
- **Release shape (2026-10-21):** the editing revamp ships on its own as 3.10.0. Chapters
  and series become 4.0, where the major bump is earned by the unit of the product
  changing — a story becomes a chaptered work becomes a series. Rolling the editing work
  into 4.0 was considered and declined: `PLAN-series-system.md` is still an undesigned
  stub, phases 1-2 are already on main under Unreleased, and holding them would delay a
  fix for a problem the editor has now. This work is deliberately the groundwork for that
  larger implementation — chapters need `entry_order` and per-chapter export, so the build
  order is editing-first regardless of the numbering.

## Related

- `docs/plans/PLAN-series-system.md` — chapters/series, Status: Idea
- `docs/TODO.md:110` — export help page with Work Skin instructions
