# Help Files Style Guide

Last Updated: 2026-10-22

The style standard for help content: the twelve pages defined by `PAGE_DEFS` in `faq.js` and
written in `db/config_files/config_help.sql`. One source serves `/story help`, `/mystory help`,
`/storyadmin help` and the Hub FAQ forum, so these rules apply to all four at once.

Approved by LeeAnn 2026-10-22. The app-wide standard this is one slice of does not exist yet —
see the `Create style_roadmap.md` section of [../TODO.md](../TODO.md), which already records the
button and emoji policy for the rest of the product.

---

## The point

Each page should read as part of a series. A reader who has learned one page should be able to
predict the shape of the next one, and recognise a topic by its emoji before reading the words.

**Emoji organize the help; they do not mirror the app.** A help heading is free to carry an emoji
the button it describes does not, and vice versa — LeeAnn, 2026-10-22: "the help text needs to be
helpful, but that doesn't always mean lockstep with what you see."

---

## Rules

1. **Every page title and every section heading carries exactly one emoji, at the front.** Body
   text carries none.
2. **An emoji is a topic's name, not decoration.** The same topic wears the same emoji everywhere
   in the help, and two different topics never share one.
3. **A page title never wears the same emoji as a heading inside that page.**
4. **Pages that form a set share one title emoji** and distinguish themselves after an em-dash
   (`📝 Create a New Story — General Options`).
5. **Two heading levels, and nesting only for a cluster that belongs together** — the renderer
   emits `##` at depth 0 and `###` at depth 1, and there is no third level.
6. **The one body-text exception** is a list of named panel fields, which may carry those fields'
   own emoji, because the reader is looking at that panel while reading it. `txtHelp4Metadata` is
   the case this exists for.

---

## Structure conventions

These are what the pages already do, recorded so they keep doing it.

- **Page order follows the arc of using the bot**, not the alphabet and not frequency:
  orientation, creating, joining, writing, reading and editing, your own dashboard, managing a
  story, the command reference, then the three admin pages as a block. Pages are addressed by
  stable id in code, so the order is free to change without breaking the contents menu, the
  command jumps or the forum sync.
- **One page is one embed**, capped at 4096 characters.
- **Two voices, used deliberately.** The Overview page has no headings at all — label-less
  paragraphs, because it is a conversational introduction. Every other page is topical reference.
- **Reference sections are definition lists:** `- **Thing** — what it does.`
- **Commands in backticks**, with `[required]` and `(optional)` arguments:
  `/story edit [id] (turn)`.
- **A `-#` small-text line** carries who is allowed to use something, at the top of the section.
- **Bold** marks anything the reader clicks.
- **A page footer** carries a caveat that applies to the whole page, not to one section.
- **A page may open with a lead paragraph and no heading** when a first heading would only repeat
  the page title. `find-join` and `overview` do this.

---

## Key naming

The digit in a help key is the page it was *created* for, not where it renders. After the
2026-10-01 split and reorder most of them no longer agree, and renaming them would orphan any
guild's overriding row, so they stay. **Keys added from here on are named for their page**
(`txtHelpOverview*`, `txtHelpFindJoinTitle`, `lblHelpWritingThreadFeatures`).

---

## Current drift, measured 2026-10-22

Found by auditing every title and heading in `config_help.sql`. **None of this is fixed yet** —
every item is user-facing text and needs LeeAnn's approval per change.

Breaks rule 4 — one set, three emoji:

| Page | Title today |
|---|---|
| `admin-server-setup` | 🔧 Admin — Server Setup |
| `admin-story-setup` | 🎛️ Admin — Story Settings |
| `admin-commands` | 🛠️ Admin — Managing Stories & Writers |

Breaks rule 2 — same topic, two emoji:

- Turn Thread Privacy is `🔒` on `find-join` and `🔑` on `create-general`.

Breaks rule 2 — one emoji, unrelated topics:

- `📖` ×5: the contents menu title, the Overview page, the Reading & Editing page, Reading a
  Story, Story Commands. Also breaks rule 3 — `📖 Reading a Story` sits inside `📖 Reading &
  Editing`.
- `⚙️` ×4: Joining Options, Managing a Story, Story Creator Commands, Story Management Panel.
- `📋` ×2 (Story Metadata, Writer Command Reference), `👤` ×2, `🗂️` ×2, `🛠️` ×2, `🚦` ×2
  (Story Mode, Ratings Filter), `🔑` ×2.
- `📜` sits on Normal Mode as well as on both Ground Rules headings, so the Ground Rules pair
  below is correct and Normal Mode is the odd one out.

Deliberate reuse, correct under rule 2 — the same topic in two places:

- `💬` Notifications, `✒️` Pen Name, `📜` Ground Rules (×2), `📝` on both Create a New Story
  pages.

Breaks rule 1:

- `lblHelp4CreatorOptions` ("Story Creator's Join Options") is the only heading with no emoji.
