# Copyedit Round Trip (Export → Edit → Import)

Status: In progress — phases 1-2 built, entry-ordering design open
Created: 2026-09-22
Last Updated: 2026-10-21 (entry ordering and import semantics)

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
at `story/edit.js:529` ("do NOT re-chunk from scratch, as that shifts boundaries
and causes orphaned content"). To add a page you must save and reopen. The only
in-app hint is `setPlaceholder()` at `story/edit.js:414`.

A placeholder renders only when the field is empty, and `setValue()` on the
preceding line always pre-fills it — so that hint almost certainly never
displays. **Not verified against a live client**; the builder just forwards
`placeholder` to the API and cannot settle a client rendering question, and this
host has no local/staging execution. Treat as strong suspicion pending a live check.

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

- `story.ao3_URL` (`db/init.sql:15`) is still created but referenced by zero
  JavaScript — dead column, available if a published-URL field is wanted back.
- `CLAUDE.md` pins discord.js 14.26.4; installed resolves to 14.27.0.
- Discord's `___text___` (underline + italic) breaks in the HTML export. The
  underline pre-pass at `story/export.js:102` is non-greedy, so `___both___`
  renders as underlined `_both` with a stray trailing underscore. Plain
  `__underline__` is fine. Pre-existing, unrelated to this work, not fixed.

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
- **Sparse values, never compacted.** Leave gaps. A soft-deleted entry keeps its
  `entry_order`, so Restore only flips `entry_status` back and the entry returns to
  the position it held — no renumbering pass, no reinsertion logic.
- **Turn number follows display order**, not chronology. The published work prints it
  at each turn break beside the author name, so a shuffled sequence there is the
  confusing outcome. Stale turn references in older Discord posts are accepted:
  whoever reordered the story knows why the numbers moved. Every site in the finding
  above switches from `started_at` to `entry_order`; the `DENSE_RANK()` pair in
  `commands/story.js` is the pattern the correlated subqueries should converge on.
- **The export delimiter does not change.** `[[turn N | #id | writer]]` already carries
  identity in `#id` and treats the turn number as display, so renumbering under a
  reorder costs nothing in the file format.

**Why the column belongs on `story_entry` and not on `turn`.** A per-entry order would
normally risk splitting a turn — interleave another turn's entry between two of turn
12's and "turn 12" appears twice with turn 13 between them. That cannot happen here:
`021_story_entry_confirmed_unique.sql` enforces **one confirmed entry per turn** via a
generated `confirmed_turn_id` column and a unique key on it. A turn carries at most one
confirmed row, so ordering confirmed entries *is* ordering turns, and no contiguity
invariant is needed.

**Correction to phase 2's shipped text.** `story/_exportText.js` and the Unreleased
changelog entry both justify matching on the entry id by claiming a turn can hold more
than one confirmed entry. Migration 021 makes that false. Matching on the id is still
right — ids are stable and turn numbers are about to start renumbering under reorder —
but the stated reason needs replacing.

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

1. ~~**Small** — an explicit "Add a page" button on the edit panel, plus
   `LabelBuilder.setDescription()` to make the save-and-reopen behaviour visible.~~
   **Built 2026-10-20**, held under Unreleased for the 3.10.0 bump. Also folded in:
   the hard-coded strings in the files it touched moved to config, `story/read.js`'s
   duplicate copy of the same modal consolidated onto the shared builder, and its
   stale copy of the config-key list replaced with the exported
   `EDIT_PANEL_CONFIG_KEYS`. See the Unreleased changelog entry.
2. **Small/medium** — single-entry export + import on the edit interface. The
   real fix for cross-page editing. Main open question is how to present it:
   framing it as one round trip ("edit as file") likely reads more clearly than
   two separate download/upload buttons.
3. **Medium** — whole-story export + import with an attached diff. Generalises
   phase 2's machinery; needs the `[[...]]` delimiter.
4. **Medium/large** — chapter interface + per-chapter export. Coordinate with
   `PLAN-series-system.md`.
5. **Medium** — `entry_order` migration: add the column, backfill from `started_at`,
   drop the orphaned `order_in_turn` and its `unique_turn_order` index, and switch all
   fourteen turn-number computations over. Prerequisite for both reordering and
   import's reorder/remove semantics. No longer deferred.
6. **Small/medium** — reorder and reassign in Manage Entries. Reassign is only
   `turn.story_writer_id` pointing at another `story_writer` row of the same story,
   with no ordering involved. Delete and Restore already exist (`story/edit.js:401`).

## Open decisions

- How to present the single-entry round trip so it is obvious to a non-developer.
- Whether chapters belong in this plan or in `PLAN-series-system.md`.
- Whether the whole-story import (phase 3) is needed at all once phase 2 exists.
- Whether reassign ships inside 3.10.0 or follows it.
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
- Display order lives in a new `story_entry.entry_order`; `started_at` is left alone as
  the record of when things happened.
- Turn numbers follow display order and renumber on reorder. Stale references in older
  Discord posts are an accepted cost.
- The old `order_in_turn` column is dropped, not repurposed.

## Related

- `docs/plans/PLAN-series-system.md` — chapters/series, Status: Idea
- `docs/TODO.md:110` — export help page with Work Skin instructions
