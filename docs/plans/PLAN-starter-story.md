# Plan: Default Starter Story on First Setup

Status: Draft, awaiting LeeAnn's review (no code written)
Created: 2026-11-19
Last Updated: 2026-11-19

## Why

A tester server (NEO MIRACLE iF Test, 2026-11-17) finished `/storyadmin setup`, created a story
within two minutes, never wrote, let the first turn time out, and uninstalled 18 seconds after
the second turn reminder. The bot's first impression was a solo clock ticking at the admin.

The idea: when setup completes for the first time, the bot creates one story in the feed channel
with an opening entry already written, waiting for writers. The admin sees a real story without
having to make a dummy one, and members see something to join.

This is a concrete version of item 2 in
[PLAN-first-run-experience.md](PLAN-first-run-experience.md) ("It must show a story, not
describe one"). If this ships, item 2 is done by it.

## Agreed so far

- The admin who completes setup can edit, delay or delete the starter story.
- LeeAnn writes the opening entry. It is credited to the bot, not the admin.
- The admin is not a writer and not in the turn order unless they join like anyone else.
- No turn starts until a second writer joins, using the existing delayed-start option.

## How it fits the existing code (verified against code, 2026-11-19)

**The admin already has the rights we want, without being "creator".** There is no creator
column. `checkIsCreator()` (`utilities.js`) means "oldest active writer". But `/story manage` and
close/delete are gated on creator **or** admin (`story/manage.js:195-196`), and whoever completes
setup has Manage Server or the admin role, so `checkIsAdmin()` already lets them in. Nothing new
is needed for this.

One side effect to know about: once people join, the first human to join becomes the starter
story's "creator" under that rule, and gets creator controls on it. See Open Question 4.

**An entry has to belong to a writer row.** `story_entry → turn → story_writer`, and the author
line comes from `story_writer.discord_display_name`. So crediting the bot means the bot gets a
`story_writer` row in that one story, with `discord_user_id` = the bot's own user id.

That row must never be picked for a turn, counted toward the writer target, or treated as
creator. Recommended: a new `WRITER_STATUS.SYSTEM = 3` in `constants.js`. Every query that
filters on `= ACTIVE` or `IN (ACTIVE, PAUSED)` skips it automatically, and that is nearly all of
the 71 `sw_status` uses. The alternative, giving it `LEFT`, would show the bot in the status
post as a former writer (`story/_storyStatus.js:175`). The sweep of every `sw_status` query is
part of the build either way.

**Delayed start works as-is, with one trap.** `checkStoryDelay()` (`story/_delay.js`) counts only
`ACTIVE` writers, and `StoryJoin()` starts the first turn with whoever's join meets the target.
The trap: writer-count and hour delays are OR'd, so if the starter story had an hour delay too,
it would start when the hours ran out even with nobody in it. **The starter story uses a writer
delay only, no hour delay.** The status post already shows "Delayed, starts at N writers (M so
far)" since 3.10.2.

**`CreateStory()` always makes the person who clicked a writer.** Step 5 calls `StoryJoin()` for
the interaction's user, and afterwards it adds them to the thread. The starter story needs an
option to skip both and to write the bot's row, turn and entry instead, inside the same
transaction.

## The build, in order

1. **Config strings** (new keys in `db/config_files/config_onboarding.sql`, and in
   `config_roadmap.md`). LeeAnn writes all of the text. Names proposed:
   - `txtStarterStoryTitle`, `txtStarterStorySummary` (if she wants a summary)
   - `txtStarterStoryEntry`, the opening entry
   - `txtStarterStoryAuthor`, the credit on the author line (see Open Question 2)
   - `txtSetupStarterStoryNote`, one line added to the setup summary pointing at the story
   - Settings (mode, turn length, rating NR, order) reuse the `/story add` defaults. Those are
     hard-coded in `story/add.js:55-83` today, so they move to one shared defaults object that
     both use, rather than a second copy here.

2. **`WRITER_STATUS.SYSTEM`** and the `sw_status` sweep described above.

3. **`CreateStory()` gets a starter-story option** (`storybot.js`). With it set, it skips the
   `StoryJoin()` of the clicker and the add-to-thread, and instead inserts the bot's writer row,
   one ended turn, and the opening entry as `confirmed` with `entry_order` 1
   (`nextEntryOrder()` in `story/_entryOrder.js`). `story_delay_users` is set to the target from
   Open Question 1. After commit, the entry is posted to the story thread with the existing
   `postThreadEntry()` (`story/_entryRenderer.js`), as Turn 1.

4. **Hook in `handleSetupSave`** (`commands/_storyadminSetupSave.js`), after the summary
   follow-up is sent so a slow or failed story creation never delays or breaks the setup result.
   The story gets the setup button's interaction, which has the guild, user and member that
   `CreateStory()` and the announcement need. A failure is logged (`show: true`, so it reaches
   `#logs`) and setup still counts as saved. Logged to `guild_event` as `starter_story_created`
   so we can see later whether anyone joins one.

5. **Feed announcement.** `postStoryFeedCreationAnnouncement()` (`announcements.js:78`) names
   the clicker as creator ("New Story Created by ..."), which would credit the admin. For the
   starter story it should name the bot (or say something else, see Open Question 2). That line
   is hard-coded English today, so this step moves it to a config key as well. The Join button
   on the announcement already works for a delayed story.

6. **Docs**: `system_roadmap.md`, `config_roadmap.md`, `ux_roadmap.md`, the setup help page,
   `INTERNAL.md`.

## Reruns of setup: no duplicates

`handleSetupSave` already knows `isFirstSetup` (no `cfgStoryFeedChannelId` row yet). Gate on
that, plus a guild config row `cfgStarterStoryId` written with `INSERT IGNORE`, the same way
`cfgGuildRegisteredAt` is written. That row:

- stops a double-click from creating two stories,
- means an admin who deletes the starter story never gets it back on a later setup save,
- lets later code recognise the starter story if it ever needs to.

If the first attempt fails (for example the bot lacks thread permissions on the feed channel,
which setup already detects and warns about), the row is written as `pending` and the next setup
save tries again. Servers set up before this ships have no row and are not touched (see Open
Question 5).

## Opt-out

Recommended: **none for now.** The admin can delete the story with the tools they already have,
and a setup toggle adds a field to a panel that is already full. Easy to add later if anyone
asks.

## Open questions for LeeAnn

1. **How many writers before turns start?** The bot's entry doesn't count as a writer. If the
   target is 1, the first person to join gets a turn alone, which is the NEO MIRACLE situation
   again. Recommended: **2**.
2. **Whose name is on it?** The author line on the entry and the "created by" on the feed
   announcement. The bot's server display name, or a name you choose in config?
3. **Content of the opening**: title, entry, and whether it gets a summary, tags or Ground
   Rules preselected. All yours to write. **Your direction, 2026-11-19:** a short story, about
   500 to 1,000 words, about how a story gets written in the bot. The story creator is a DM
   figure who sets the scene, configures the turns and picks the Ground Rules, and members join
   like characters joining a D&D party. That way the opening teaches the bot while being the
   kind of thing people want to continue.
   Title candidates she floated: "The Fellowship of the Pen", "The Fellowship of the Story".
   Practical notes: 1,000 words is about 5,500 to 6,000 characters. The `story.max_entry_length`
   column (default 5,000) is not read anywhere in the code, so nothing blocks that length, and
   `postThreadEntry()` already splits a long entry into pages. Open sub-question: if the opening ends mid-scene, should the next writer pick up
   the narrative, or is the meta story a prologue and the real story starts with them?
4. **First joiner becomes "creator"** of the starter story under the existing rule, so they could
   edit settings or close it. Fine, or should the starter story be admin-only to manage?
5. **Existing servers**: leave them alone (recommended), or offer them one?
6. **Thread and creator tip**: `CreateStory()` posts `txtStoryThreadCreatorTip` in every new story
   thread, which speaks to the creator. Skip it for the starter story, or keep it for the admin?
7. **Should the admin be added to the story thread** so it shows in their sidebar, even though
   they aren't a writer?

Not part of this plan, but related: the tester's own story started a turn the moment they
created it, alone. That is item 3 (Start Story button) in
[PLAN-first-run-experience.md](PLAN-first-run-experience.md), which is the direct fix for that
part of what happened. A starter story only helps if the admin uses it instead of making their
own.

## Version

Proposal for when it's built, for your sign-off then: **MINOR**. It touches story creation, adds
a writer status that every writer query has to respect, and changes the first thing a new
server sees.
