# Plan: Starter Story on First Setup

Status: Built, shipped as 3.11.0 (PR #100), awaiting a live test on a fresh server
Created: 2026-11-19
Last Updated: 2026-11-19

The design was worked out with LeeAnn in a Claude Doc
(https://claude.ai/artifact/1dHvLVuWdywSur6gewQePd) and this file records where it landed.

## Why

A tester server (NEO MIRACLE iF Test, 2026-11-17) finished `/storyadmin setup`, created a story
within two minutes, never wrote, let the first turn time out, and uninstalled 18 seconds after
the second turn reminder. The bot's first impression was a solo clock ticking at the admin.

The starter story gives a new admin a real story in motion, with their own turn waiting and
nothing nagging them. LeeAnn expects most servers to delete it. Its job is to introduce the flow
of the bot in a friendly, engaging way, so deleting it stays easy and the story itself says how.

This covers item 2 of [PLAN-first-run-experience.md](PLAN-first-run-experience.md) ("It must show
a story, not describe one").

## The flow

On the first `/storyadmin setup` save on a server, after the setup summary has been sent:

1. A story is created in the feed channel in **Slow mode, no delay, reminders off**, with the
   `/story add` defaults for everything else (Round Robin order, rating NR).
2. A made-up stranger, **The Hooded Stranger** (`txtStarterStoryAuthor`), is its first writer.
   Discord has no made-up users, so the row uses the bot's own user id under the stranger's name.
   Its opening entry (`txtStarterStoryEntry`, written by LeeAnn, about 4,800 characters) is
   written straight to the DB as Turn 1, already ended and confirmed. It is not started through
   `NextTurn`, which would open a turn thread and DM the bot's own account.
3. The admin who saved setup is added as a writer and gets **Turn 2** through `NextTurn`.
4. The stranger is marked LEFT in the same transaction. The admin is then the creator under the
   existing oldest-active-writer rule (`checkIsCreator`), and has admin rights anyway.
5. After commit, the story thread gets, in order: the status post and creator tip, the
   stranger's Turn 1 line, the admin's join line, the opening entry, the admin's Turn 2 line, and
   the stranger's exit line (`txtStarterStoryStrangerLeaves`: "take up the pen, or delete this
   story and start your own adventure!").
6. The feed announcement names the stranger as creator, not the admin.

Ground Rules preselected (`cfgStarterStoryGroundRules`): Respect Other Writers' Choices and
Conflict, Not Contempt, each only if the server still has it. An admin can rename or remove rules
in setup, so a missing one is skipped and logged.

## Decisions

- **No duplicates, ever.** A per-server config row `cfgStarterStoryId` is claimed atomically
  before anything is created: `INSERT IGNORE` on first setup, otherwise only an `UPDATE` from
  `pending`. It holds the story id once made. A failed first attempt (feed permissions missing,
  config missing, CreateStory error) sets it to `pending`, so the next setup save retries.
- **An admin who deletes the starter story never gets it back.** The row stays.
- **Servers set up before this shipped get none.** They have no row and a later save never
  inserts one. Running it for installed-but-inactive servers was floated, but there is no good
  way to know which admin should get the turn, so not now.
- **The setup user's id is not saved.** Admins come and go and roles change (LeeAnn).
- **No opt-out toggle.** Deleting the story is the opt-out.
- **Its own funnel event.** `guild_event` gets `starter_story_created` instead of
  `story_created`, so the "did an admin make a story" number isn't inflated.
- **Rolled in, for every story:** Round Robin (2) is the default turn order for new stories
  (`story/_storyDefaults.js`, shared by `/story add` and the starter story). Every story creation
  now posts the creator's join line in the story thread. Existing stories keep their order.

## What was built

- `story/_storyDefaults.js` (new): `STORY_DEFAULTS`, the new-story defaults. `story/add.js`
  spreads it into the panel state.
- `story/_starterOpening.js` (new): `seedStarterOpening()`, the stranger's writer row, ended
  Turn 1 and confirmed entry. Separate from `_starterStory.js` to avoid an import cycle with
  `storybot.js`.
- `story/_starterStory.js` (new): `pickStarterGroundRules()`, `buildStarterStoryInput()`,
  `claimStarterStory()`, `maybeCreateStarterStory()`.
- `storybot.js`: `CreateStory(connection, interaction, storyInput, { starter })`, which returns
  `storyId`. New `postStoryThreadOpening()` posts the thread's opening lines in order after
  commit. `StoryJoin` returns `displayName`.
- `announcements.js`: `postStoryFeedCreationAnnouncement(..., { creatorName })`, and its title
  moved from hard-coded English to `txtStoryFeedCreatedTitle`.
- `commands/_storyadminSetupSave.js`: calls `maybeCreateStarterStory()` after the final summary.
- Config: six keys in `config_onboarding.sql`, one in `config_storyadmin.sql`.
- Tests: `test/starterStory.test.js`.

## Open, not part of this build

- The entry author line format `Turn N — name` is hard-coded in `story/_writeFinalize.js` and
  reused here. Pre-existing, worth moving to config separately.
- The setup help page doesn't mention the starter story yet. Copy for LeeAnn if she wants it.
- Broader story thread announcements (leave, pause, pen name changes) stay in `docs/TODO.md`.
