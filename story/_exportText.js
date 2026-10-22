// Plain-text export of a story's entries for copyediting, as opposed to export.js's HTML,
// which is the AO3 publication artifact.
//
// The two exports exist for different jobs and should not be confused. The HTML is rendered:
// Discord markdown is converted, [[break]] becomes the story's divider text, [[a|b]] becomes a
// tooltip span, and images are embedded as data URIs. That is right for publishing and wrong for
// editing, because what you edit is not what is stored.
//
// This export is the opposite. It writes story_entry.content verbatim — no markdown conversion,
// no marker substitution, no image handling — so the text in the file is exactly the text in the
// database. That is what makes a round trip possible: the importer can compare what came back
// against what went out without reversing a render. See docs/plans/PLAN-copyedit-round-trip.md.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getConfigValue, log, replaceTemplateVariables } from '../utilities.js';
import { fetchStoryForExport, buildExportFilename } from './_exportData.js';
import { STORY_STATUS } from '../constants.js';

// The per-entry delimiter. Deliberately NOT a config value: it is a structural token the
// importer has to parse, so a guild editing its wording would break import rather than
// translate it. Follows the existing [[...]] bot-tag convention, which is likewise fixed in
// code ([[break]] is hard-coded in story/_entryMarkup.js).
//
// The entry id is what import matches on. Turn number and writer are there for the human
// reading the file. The turn number cannot carry identity: it is a *display* number, computed
// from the entry order rather than stored, so one entry is turn 4 today and turn 7 after a
// reorder, and a file exported before that reorder would match the wrong entry. Once import
// can reorder, the file's turn numbers are input for the new order, which makes matching on
// them circular besides. A writer name is not unique either. The entry id never changes.
// (An earlier version of this comment said a turn can hold several confirmed entries. It
// cannot: migration 021 enforces one per turn. See docs/plans/PLAN-copyedit-round-trip.md.)
// Turn number and entry id sit in fixed leading positions and the writer name goes last, so a
// pen name containing a '|' or a '·' cannot shift what the parser reads as the id.
const ENTRY_DELIMITER_RE = /^\[\[turn\s+(\d+)\s*\|\s*#(\d+)\s*(?:\|\s*([\s\S]*?))?\s*\]\]$/;

export function buildEntryDelimiter(turnNumber, entryId, writerName = null) {
  const who = writerName ? ` | ${writerName}` : '';
  return `[[turn ${turnNumber} | #${entryId}${who}]]`;
}

// Parses a delimiter line back to { turnNumber, entryId, writerName }, or null if the line is
// not one. Exported for the importer and for tests — the round trip's correctness rests on these
// two functions agreeing, so they live together.
//
// writerName is null when the file carries no name, which is what a story with show_authors off
// exports. The whole-story import reads it as the reassignment instruction: a name that changed
// means "credit this turn to that writer". It is the last field for that reason — a pen name
// containing a '|' cannot shift what the parser reads as the id.
export function parseEntryDelimiter(line) {
  const match = ENTRY_DELIMITER_RE.exec(line.trim());
  if (!match) return null;
  return {
    turnNumber: parseInt(match[1], 10),
    entryId: match[2],
    writerName: match[3]?.trim() || null,
  };
}

// The export instant, as a machine-readable trailer on the last line.
//
// Separate from the header's human-readable [exported] date, which stays a plain day so the
// approved header copy is untouched. Full precision is what makes conflict detection
// possible on import: the question is "was this entry edited in Discord after this file was
// exported?", and a date alone cannot answer that for an edit made the same day — which is
// the common case, since a file is usually exported and re-imported within a day or two.
//
// Fixed in code rather than config, for the same reason the entry delimiter is: the importer
// parses it, so a guild rewording it would break conflict detection rather than translate it.
// The importer reads it from the end of the file rather than by scanning, so an entry whose
// prose happens to contain a similar line cannot be mistaken for the trailer.
const EXPORT_STAMP_RE = /^\[\[exported-at\s+(\S+)\s*\]\]$/;

export function buildExportStamp(date) {
  return `[[exported-at ${new Date(date).toISOString()}]]`;
}

// Returns a Date, or null if the line is not a stamp or carries an unparseable instant.
// A file exported before this trailer existed simply has none; import still works, it just
// cannot conflict-check, and should say so rather than skipping the check silently.
export function parseExportStamp(line) {
  const match = EXPORT_STAMP_RE.exec(String(line ?? '').trim());
  if (!match) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Builds the plain-text editing export. Mirrors generateStoryExport's return shape so callers
 * can treat the two interchangeably.
 * Returns null if the story is not found, else
 * { hasEntries, buffer, filename, title, turnCount, wordCount, writerCount, entryCount }.
 */
export async function generateEntriesTextExport(connection, storyId, guildId, { guildName } = {}) {
  const fetched = await fetchStoryForExport(connection, storyId, guildId);
  if (!fetched) return null;
  const { story, writers, entries } = fetched;

  const writerCount = writers.length;
  if (entries.length === 0) {
    return {
      hasEntries: false, title: story.title, turnCount: 0, wordCount: 0,
      writerCount, entryCount: 0, buffer: null, filename: null,
    };
  }

  const wordCount = entries.reduce((total, e) => total + e.content.trim().split(/\s+/).filter(Boolean).length, 0);
  const turnCount = entries[entries.length - 1].turn_number;

  // txtOpen/txtClosed are the existing status words, reused rather than a new pair of keys.
  const cfg = await getConfigValue(connection, [
    'txtExportTextHeader', 'txtExportTextLegend',
    'txtOpen', 'txtClosed',
  ], guildId);

  const fmt = d => new Date(d).toISOString().slice(0, 10);
  // One instant for both the human date and the machine trailer, so they cannot disagree.
  const exportedAt = new Date();

  // Writer list for the header: everyone who has an entry in the work, in order of their
  // first one. Taken from the entries rather than from fetchStoryForExport's writer list,
  // because that list is active members only — a writer who has since left still wrote prose
  // the editor is about to touch, and a member who joined but never wrote is not an author of
  // it. Honoured against show_authors for the same reason the per-entry delimiters are: this
  // file is reachable from the public close announcement, so a story whose writers chose not
  // to be credited must not leak their names here. With no names, the header's {?...?} block
  // strips itself.
  const authors = story.show_authors
    ? [...new Set(entries.map(e => e.pen_name || e.discord_display_name).filter(Boolean))].join(', ')
    : '';

  const header = replaceTemplateVariables(cfg.txtExportTextHeader, {
    title: story.title,
    ...(authors ? { authors } : {}),
    story_num: String(story.guild_story_id),
    turn_count: String(turnCount),
    entry_count: String(entries.length),
    word_count: wordCount.toLocaleString(),
    exported: fmt(exportedAt),
    status: story.story_status === STORY_STATUS.CLOSED ? cfg.txtClosed : cfg.txtOpen,
  });

  // The story's own divider text is substituted into the legend, because [[break]] means
  // nothing to a reader who cannot see what it renders as.
  const legend = replaceTemplateVariables(cfg.txtExportTextLegend, {
    ...(story.scene_break_divider ? { divider: story.scene_break_divider } : {}),
  });

  const body = entries.map(entry => {
    // show_authors is honoured here as it is in the HTML export: this file is reachable from
    // the public close announcement, so any writer can download it.
    const writerName = story.show_authors ? (entry.pen_name || entry.discord_display_name) : null;
    const delimiter = buildEntryDelimiter(entry.turn_number, entry.story_entry_id, writerName);
    // content goes out verbatim. Trailing whitespace is trimmed only at the very edge of the
    // block so the delimiters sit on their own lines; nothing inside the entry is touched.
    return `${delimiter}\n\n${entry.content.replace(/\s+$/, '')}`;
  }).join('\n\n');

  // No human-readable footer: it reprinted the entry count and told the reader only that they
  // had reached the end of the file they were looking at. The stamp below is the end marker
  // that matters, and it is for the importer.
  const text = `${header}\n\n${legend}\n\n${body}\n\n${buildExportStamp(exportedAt)}\n`;

  log(`generateEntriesTextExport: story ${storyId} wrote ${entries.length} entr(ies), ${turnCount} turn(s), ${text.length} chars`, { show: false, guildName });

  return {
    hasEntries: true,
    title: story.title,
    turnCount,
    wordCount,
    writerCount,
    entryCount: entries.length,
    buffer: Buffer.from(text, 'utf8'),
    // The count rides in the name, not just the word: it tells the editor at a glance which
    // version of a file they are looking at, alongside the timestamp.
    filename: buildExportFilename({
      guildStoryId: story.guild_story_id, title: story.title,
      part: `${entries.length}_entries`, exportedAt, ext: 'txt',
    }),
  };
}

// Every config key buildCloseExportRow needs. Exported for the same reason
// EDIT_PANEL_CONFIG_KEYS is: two files render this row and must not keep separate lists.
export const EXPORT_ROW_CONFIG_KEYS = ['btnExportNoBreaks', 'btnExportWithBreaks', 'btnExportForEditing'];

// The export button row on a close announcement. story/close.js (the standalone /story close)
// and story/_manageClose.js (the manage panel's fork of it, temporary — see docs/TODO.md) both
// posted a byte-identical copy of this row, so adding a third button meant editing it twice.
export function buildCloseExportRow(cfg, storyId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`story_export_close_noturns_${storyId}`)
      .setLabel(cfg.btnExportNoBreaks)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`story_export_close_withturns_${storyId}`)
      .setLabel(cfg.btnExportWithBreaks)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`story_export_close_entries_${storyId}`)
      .setLabel(cfg.btnExportForEditing)
      .setStyle(ButtonStyle.Secondary)
  );
}

// Delivers the plain-text editing export as an ephemeral attachment. Shared by the close
// announcement's button (story_export_close_entries_<storyId>) and /story read's
// (story_read_download_entries), which differ only in where the storyId comes from.
//
// Deliberately offers no "post publicly" follow-up, unlike the HTML export: this file is a
// working copy for whoever is editing, not something the group reads.
export async function handleEntriesTextExportButton(connection, interaction, storyId, guildId) {
  try {
    const result = await generateEntriesTextExport(connection, storyId, guildId, { guildName: interaction?.guild?.name });
    if (!result?.hasEntries) {
      return await interaction.followUp({
        content: await getConfigValue(connection, 'txtExportTextNoEntries', guildId),
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.followUp({
      content: replaceTemplateVariables(
        await getConfigValue(connection, 'txtExportTextInstructions', guildId),
        { entry_count: String(result.entryCount), word_count: result.wordCount.toLocaleString() }
      ),
      files: [{ attachment: result.buffer, name: result.filename }],
      flags: MessageFlags.Ephemeral,
    });
    log(`handleEntriesTextExportButton: story ${storyId} text export delivered to ${interaction.user.username}`, { show: true, guildName: interaction?.guild?.name });
  } catch (err) {
    log(`handleEntriesTextExportButton failed for story ${storyId}: ${err?.stack ?? err}`, { show: true, guildName: interaction?.guild?.name });
    await interaction.followUp({
      content: await getConfigValue(connection, 'errProcessingRequest', guildId),
      flags: MessageFlags.Ephemeral,
    });
  }
}
