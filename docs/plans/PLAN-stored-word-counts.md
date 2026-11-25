# Plan: stored entry word counts and one save path

Status: Approved 2026-11-25, built on PR #105 as 3.12.0, awaiting merge and Redeploy
Created: 2026-11-24
Last Updated: 2026-11-25

Worked out with LeeAnn in a Claude Doc (https://claude.ai/artifact/Dij3jHhwhkmhkxyShM426Q). Her
approval, on the version line: "this is approved. The plan looks good and is ready to implement."
This file records where it landed.

## Why

Each entry stores its own word count once, at save time, and every total becomes a sum of that column. Today word counts are worked out in 12 places, four different ways, so the status post, `/story read`, `/mystory list` and the roundup can show different numbers for the same story.

- Five places load every entry's full text and count it in code, one story at a time. The status post does this on every refresh.
- Three places can't afford that because they cover many stories, so they estimate in SQL by counting spaces.
- The count itself had drifted into three formulas (blanks, image links, scene breaks all handled differently).

This came out of the entry footer work: LeeAnn wants the story total on every story thread post, which is cheap only if totals are cheap. All 8 places that save entry text will go through one shared save module, so no future save path can forget the count.

## Design

**Storage.** New column `story_entry.word_count INT NULL` (NULL means not counted yet, see Migration and backfill), set whenever an entry's text is saved and never written anywhere else.

**What counts as a word** (`countWords()` in `story/_wordCount.js`, the one counter). It matches AO3, since stories are exported there: the core is AO3's own counter, already ported in ficfeed's `commands/wordcount.js` (`countTextNodeWords` and its pattern, from AO3's `lib/word_counter.rb`). Agreed with LeeAnn 2026-11-24.

- Before counting, our own steps: image URLs are removed (a `[caption](url)` link keeps its caption) and `[[break]]` scene-break lines are skipped.
- A word is a run of letters, digits and joining marks. Anything else ends it, so "one—two" and "well...okay" are 2 words each, and "1,200" is 2 (AO3's quirk, copied so the numbers match).
- "--" counts as a dash, then apostrophes and hyphens are dropped, so "one-word" and "one's" are 1 word each.
- Chinese, Japanese and Thai count one word per character.
- Translation tooltips count both halves: `[[mae govannen|well met]]` is 4 words. AO3 counts the hidden translation in the exported tooltip, and Discord shows it in italics, so both are real text.
- Bare punctuation ("\* \* \*", a lone "—") has no letters or digits, so it isn't counted.

Counts are exact under those rules, so the "\~" is dropped wherever they're shown. ficfeed's walk through HTML text nodes isn't needed, because entries are stored as plain text. Unit tests cover each rule, including a case from each bullet above.

**Save module** `story/_entryContent.js`, two functions. Both take `conn` as either a plain connection or an open transaction; callers keep control of their transactions.

| Function | Used by | Arguments |
| --- | --- | --- |
| `insertEntry(conn, { turnId, content, status, entryOrder })` returns the new entry id | Finalize, quick mode first save, starter story | `entryOrder` optional (quick mode's pending row gets its order at confirm). Sets `created_at` and `word_count`. |
| `updateEntryContent(conn, entryId, content, { editor, previousContent, status, resetCreatedAt })` | Edit save, version restore, file round trip, story import, quick mode rewrite | `editor` `{ id, name }`: when given, writes the old text to edit history first (replaces four copies of that INSERT). `status`: only restore and quick rewrite. `resetCreatedAt`: quick rewrite only. |

Anything that changes an entry without changing its text (delete, Restore button, reorder, change writer) stays as it is, since its count can't change.

**Totals.** `getStoryWordCount(conn, storyId)` returns `SUM(word_count)` over confirmed entries, for the per-story callers. List views add `SUM(se.word_count)` to the query they already run.

## Every save path and every count

All 8 writes of entry text move to the save module. Line numbers are on `main` as of 2026-11-24.

| Save path | Where today | After |
| --- | --- | --- |
| Finalize (normal/slow) | `story/_writeFinalize.js:354` INSERT | `insertEntry`, confirmed, next order |
| Quick mode first save | `story/_writeQuickMode.js:116` INSERT | `insertEntry`, pending, no order |
| Quick mode rewrite after discard | `story/_writeQuickMode.js:110` UPDATE | `updateEntryContent`, status pending, `resetCreatedAt` |
| Starter story | `story/_starterOpening.js:34` INSERT | `insertEntry`, confirmed, next order |
| Edit save | `story/edit.js:950` history + UPDATE | `updateEntryContent` with `editor` |
| Restore older version | `story/_editHistory.js:186` history + UPDATE | `updateEntryContent` with `editor`, status confirmed |
| File round trip import | `story/_editFileRoundTrip.js:389` history + UPDATE | `updateEntryContent` with `editor` |
| Story import (per changed entry) | `story/_importStory.js:354` history + UPDATE | `updateEntryContent` with `editor` |

Every place a count is shown, and where its number will come from:

| Shown in | Where today | Today | After |
| --- | --- | --- | --- |
| `/story read` story total | `story/read.js:307` | counts all text | sum of stored counts on rows it already loads |
| Read view after an edit | `story/edit.js:967`, `:1017` | recounts all text | re-sum stored counts |
| Status post | `story/_storyStatus.js:127` | counts all text each refresh | `SUM(word_count)`; still reads text for its image count |
| Export, HTML and text | `story/export.js:153`, `story/_exportText.js:105` | counts all text | sum of stored counts |
| Close stats and feed post | `story/close.js:30` | counts all text | `getStoryWordCount` |
| Entry footers (read, thread posts) | `story/_entryRenderer.js:39` | counts the entry | stored count |
| Previews (finalize, quick) | same | counts the entry | live count, the text isn't saved as confirmed yet |
| Edit/import round trip and import plan | `story/_editFileRoundTrip.js:61`, `story/_importPlan.js:25` | counts | live `countWords`, comparing unsaved text |
| `/mystory list` (mine and total) | `commands/_myStoryList.js:88`, `:97` | SQL space estimate | `SUM(se.word_count)` |
| Manage Entries list | `story/_manageEntriesList.js:48` | SQL space estimate | `se.word_count` |
| Weekly roundup | `story/roundup.js:48` | SQL space estimate | `SUM(se.word_count)`, drop the \~ |
| Story thread post story total (new) | none | not shown | `getStoryWordCount` after the entry is saved |

## Migration and backfill

The column is added in SQL and filled in by the bot at startup, because the migration runner only runs plain SQL and the count rules live in JavaScript.

1. `db/migrations/028_story_entry_word_count.sql` adds `word_count INT NULL`. NULL means "not counted yet". No semicolons in its comments (the runner splits on them).
2. A backfill step runs once the bot has logged in to Discord, not in `deploy.js`. Anything logged in `deploy.js` runs before login and never reaches Hub #logs (the gap that hid the failed migration on 2026-11-04). It finds entries where `word_count IS NULL`, counts them with `countWords()` in batches of 500, and writes the numbers back.
3. The step runs on every start but does nothing once every row has a count, so it also repairs any row a future bug leaves uncounted.

Every entry status gets counted, not just confirmed ones, so a restored entry already has its number. Totals only ever sum confirmed entries.

Until the backfill finishes (seconds with today's data), totals undercount entries not yet counted. Running it right after login keeps that window short.

## Logging

The new code follows the two-tier logging rule, and passes context the way the codebase already does: an optional `guildName` in each function's options, like `story/_entryChangeLog.js`. There's no new logging-context helper. The save functions log what they know (entry, turn, editor). The story and the acting user stay in each caller's existing action log line, so nothing is logged twice.

| Event | Tier | What it logs |
| --- | --- | --- |
| Each save (`insertEntry`, `updateEntryContent`) | test mode (`show: false`) | entry id, turn id, status, text length, word count stored, and editor plus "history copy written" when given |
| `getStoryWordCount` | test mode | story id and the total returned |
| Backfill progress | test mode | each batch: "counted 500, 1,200 left" |
| Save failure | always (`show: true`) | `insertEntry failed for turn 12: <stack>`. "failed" also sends it to Hub #logs |
| Backfill summary or failure | always, `hub: true` | how many entries were counted, or the error |
| Non-empty text counted as 0 words | always | entry id and text length: the one sign the counter itself is broken |

## Entry footer

Every place an entry is shown uses one config footer, `lblEntryFooter`, grouped into an Entry part and a Story part. Wording approved 2026-11-25.

| Where | Footer |
| --- | --- |
| `/story read`, split entry | Turn 5 · Ana · Entry: part 2 of 2, 512 total words · Story: page 14 of 20, 9,800 total words |
| `/story read`, entry not split | Turn 5 · Ana · Entry: 512 total words · Story: page 14 of 20, 9,800 total words |
| Story thread post (last message of the entry) | Turn 5 · Ana · Entry: 512 total words · Story: 9,800 total words |
| Finalize or quick preview, long entry | Turn 5 · Entry: part 1 of 2, 512 total words |
| Authors hidden | the writer's name is left out, everything else the same |

Agreed so far: "part" is a piece of one entry, "page" is a screen of the whole story. Part shows only when an entry is split, page only in `/story read`. Previews show the real turn number, not "—". The thread post's author line ("Turn 5 · Ana") moves into config. The quick preview's character count and expiry move into their own embed field, since timestamps don't render in footers.

Decisions:

- Keep "total" in "512 total words". Decided 2026-11-24: keep it, because on a split entry it shows the count is the whole entry, not the part on screen.
- Commit `25828ef` on the PR #105 branch holds an earlier, unapproved version of the footer and the word-count helper. Removed 2026-11-25 when the plan was built (branch force-pushed).

## User-facing text

Every string this plan adds or changes. Approved with the plan on 2026-11-25. Footer wording follows the Entry footer section above; "total" stays (decided 2026-11-24).

| Key | New or changed | Proposed value |
| --- | --- | --- |
| `lblEntryFooter` | changed | `Turn [turn]{? · [writer]?} · Entry: {?part [part] of [partCount], ?}[entryWords] total words{? · Story: [storyPart]?}` |
| `lblEntryFooterStory` | new | `{?page [page] of [total], ?}[storyWords] total words` (fills `[storyPart]`, so a thread post can show the story total without a page) |
| `lblEntryAuthor` | new | `Turn [turn] · [writer]{? [edited]?}` (thread post author line, was hardcoded in 5 files) |
| `txtEntryEditedMark` | new | `(edited)` |
| `txtEntryStatsTemplate` | changed | `Characters: [char_count]/4000` `only (expiry moves to txtPreviewExpiresLine, see below`) |
| `txtStatusEntryStats`, `txtExportStatsLine`, `txtStoryClosedPublic`, `txtStoryFeedClosed`, `txtRoundupActivity` | changed | the same text with the "\~" before `[word_count]` removed |

Two hardcoded strings sit right next to this work. Include them (decided 2026-11-24). The expiry line becomes its own key so the quick preview field and the reminder DM share it, and txtEntryStatsTemplate keeps only the characters line.

| Key | New or changed | Proposed value | Replaces |
| --- | --- | --- | --- |
| `txtEntryEditedBy` | new | `*edited by [editor] · [edited_at]*` | hardcoded line under an edited entry in `/story read` (`story/_entryRenderer.js`, `buildEntryEmbed`) |
| `txtPreviewExpiresLine` | new | `[expires_label] [expires]`, e.g. "⏰ Expires in 10 minutes" | hardcoded "⏰ Expires:" in the quick mode reminder DM (`story/_writeQuickMode.js:140`), and the second line of the preview's stats field |
| `txtEntryStatsTemplate` | changed | `Characters: [char_count]/4000` | the old two-line value (the words line moves to the footer) |

## Reuse

Searched before designing; nothing existing saved entry text or summed stored counts, so the two save functions and `getStoryWordCount` are new. Everything else is reused:

- **Word counting:** AO3's counter as already ported in ficfeed's `commands/wordcount.js`.
- **Image links:** `extractImageUrls()` from `story/_imageUrls.js`, the one definition of an image URL.
- **Preview turn number:** `confirmedEntryCountSubquery()` from `story/_entryOrder.js`, the same one `doFinalizeEntry` uses.
- **Entry order on insert:** `nextEntryOrder()` from `story/_entryOrder.js`.
- **Optional footer parts:** the `{?...?}` blocks in `replaceTemplateVariables()`.
- **Logging context:** the `{ guildName }` option pattern from `story/_entryChangeLog.js`.
- **Config keys:** `lblEntryFooter`, `txtPreviewExpires`, `lblEntryStats` and `txtEntryStatsTemplate` are reused, not replaced.
- `getStoryStats()` in `story/close.js` keeps its job but takes its word count from `getStoryWordCount`.

## File sizes

No file crosses 500 lines because of this plan. Two are already over and stay roughly the same size.

| File | Lines on main | After (estimate) | Note |
| --- | --- | --- | --- |
| `story/edit.js` | 1,139 | about 1,120 | already in the TODO's file-size split pass |
| `commands/_myStoryList.js` | 530 | about 525 | two SQL estimates become `SUM(se.word_count)` |
| `story/_writeFinalize.js` | 513 | about 515 | LeeAnn OK'd its length in October |
| `story/_entryRenderer.js` | 248 | about 300 | gains the footer builder and thread-post wrapper |
| `story/_wordCount.js` | new | about 60 |  |
| `story/_entryContent.js` | new | about 150 | the two save functions and `getStoryWordCount` |

Other touched files shrink slightly or stay the same, since each loses an inline INSERT or count.

## Build order, testing and release

Built in one PR (#105), in this order:

1. `story/_wordCount.js` (`countWords`) with unit tests for each counting rule.
2. Migration 028 and the startup backfill, logged to Hub #logs.
3. `story/_entryContent.js` (`insertEntry`, `updateEntryContent`, `getStoryWordCount`) with fake-connection tests, then move the 8 save paths onto it one at a time.
4. Switch the 12 count sites to stored counts, and drop the "\~" from `txtStatusEntryStats`, `txtExportStatsLine`, `txtStoryClosedPublic`, `txtStoryFeedClosed` and `txtRoundupActivity`.
5. The footer: `lblEntryFooter`, the author line key, previews, thread posts with the story total.
6. Docs: JSDoc on both save functions saying every write of entry text must go through them and why, `system_roadmap.md` rows, `config_roadmap.md` keys, an `INTERNAL.md` entry explaining the migration, and this plan into `docs/plans/`.

**Version:** proposed 3.12.0 (MINOR): a migration, about 15 files, and a visible change in every entry view. Approved with the plan.

**After deploy:** Redeploy in Coolify, check the backfill's line in Hub #logs, then compare one story's total in the status post, `/story read` and `/mystory list`. They should match exactly.

**Not in this plan:** a wider audit for other logic that should be centralized, plus hardcoded text and thin logging. That's logged in `docs/TODO.md` for a future system audit.
