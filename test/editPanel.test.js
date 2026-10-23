import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditMessage, buildEntryModal, EDIT_PANEL_CONFIG_KEYS } from '../story/edit.js';
import { chunkEntryContent, EDIT_PAGE_LIMIT } from '../utilities.js';

// The real values from db/config_files/config_story.sql. Kept literal rather than read from the
// SQL so a wording change there can't quietly change what these assertions are testing.
const cfg = {
  lblEditEmbedTitle: '#[story_num] [title] · Turn #[turn]{? · Page [page] of [total]?}',
  txtEditEmbedFooter: '[chars] / [limit] on this page of [total_chars] in the full entry.',
  lblEditModalTitle: 'Edit Entry{? — Page [page] of [total]?}',
  txtEditModalPageHint: 'Page [page] of [total] · [chars] of [limit] characters used.{? Save any changes, then use [add_label] for more room.?}',
  btnEditAddPage: '➕ Add Page',
  btnEditOpen: 'Edit',
  btnEditPrev: '← Prev',
  btnEditNext: 'Next →',
  btnEditHistory: 'History',
  lblEditEntryContent: 'Entry content',
  lblEditPageSplitNotice: '📄 Entry split across pages',
  txtEditPageSplitInstructions: 'Edits on this page do not affect other pages in the entry.',
  lblPageJumpOption: 'Page [page]',
  lblPageJumpPlaceholder: 'Page [page] of [total]',
  btnEditExportFile: 'Export for Editing',
  btnEditImportFile: 'Import Edited Entry',
  btnEditNextEntry: 'Edit Next Entry →',
};

// Not part of EDIT_PANEL_CONFIG_KEYS: openEditSession fetches these on top of it for the
// Manage Entries panel's admin rows. Only needed by the full-panel row-budget test below.
const manageCfg = {
  btnManageEntriesDelete: 'Delete',
  btnManageEntriesRestore: 'Restore',
  btnManageEntriesChangeOrder: 'Change Order',
  btnManageEntriesChangeWriter: 'Change Writer',
  btnEditBackToList: '← Back to entries list',
};

const SINGLE_TEXT = 'Short entry text.';
const singlePage = () => chunkEntryContent(SINGLE_TEXT);
const multiPage = () => chunkEntryContent('word '.repeat(2000));
// What btnEditAddPage pushes onto the session: an empty page spanning no characters at the end.
const withAddedPage = () => {
  const chunks = singlePage();
  chunks.push({ text: '', start: SINGLE_TEXT.length, end: SINGLE_TEXT.length, isNew: true });
  return chunks;
};

const customIds = msg =>
  msg.components.flatMap(row => row.toJSON().components.map(c => c.custom_id));

describe('EDIT_PANEL_CONFIG_KEYS', () => {
  test('covers every key buildEditMessage and buildEntryModal read', () => {
    for (const key of Object.keys(cfg)) {
      assert.ok(EDIT_PANEL_CONFIG_KEYS.includes(key), `missing key: ${key}`);
    }
  });
  test('has no duplicates', () => {
    assert.equal(new Set(EDIT_PANEL_CONFIG_KEYS).size, EDIT_PANEL_CONFIG_KEYS.length);
  });
});

describe('buildEditMessage', () => {
  test('single-page entry renders no page suffix in the title', () => {
    const embed = buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg).embeds[0].toJSON();
    assert.equal(embed.title, '#42 My Story · Turn #7');
  });

  test('multi-page entry renders the page suffix', () => {
    const chunks = multiPage();
    const embed = buildEditMessage(chunks, 1, true, 7, 'My Story', 42, cfg).embeds[0].toJSON();
    assert.equal(embed.title, `#42 My Story · Turn #7 · Page 2 of ${chunks.length}`);
  });

  test('footer quotes the page limit actually used to split', () => {
    const embed = buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg).embeds[0].toJSON();
    assert.equal(
      embed.footer.text,
      `${SINGLE_TEXT.length} / ${EDIT_PAGE_LIMIT} on this page of ${SINGLE_TEXT.length} in the full entry.`
    );
  });

  test('Add Page is offered on a single-page entry too', () => {
    const msg = buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg);
    assert.ok(customIds(msg).includes('story_edit_add_page'));
  });

  // An empty page is only reachable via Add Page, and EmbedBuilder's description validator
  // rejects '' (min length 1), so this would throw without the placeholder space.
  test('an empty added page renders rather than throwing', () => {
    const embed = buildEditMessage(withAddedPage(), 1, false, 7, 'My Story', 42, cfg).embeds[0].toJSON();
    assert.ok(embed.description.length >= 1);
    assert.equal(embed.footer.text.startsWith('0 /'), true);
  });

  test('no action row exceeds Discord 5-component limit, with every button shown', () => {
    // Prev + Next + Edit + Add Page + History is exactly 5 — the row is full. The manage row is
    // at 4 of 5 (Delete, Restore, Change Order, Change Writer), and the last row carries the two
    // file buttons plus Back to List, so the worst case is 4 rows: page-jump select, nav row,
    // manage row, that tail row. A fifth row would sit on Discord's hard limit.
    const msg = buildEditMessage(multiPage(), 0, true, 7, 'My Story', 42, { ...cfg, ...manageCfg }, { manageMode: true, hasPicker: true, fileRoundTrip: true });
    assert.ok(msg.components.length <= 4, 'the worst-case panel left no spare action row');
    for (const row of msg.components) {
      assert.ok(row.toJSON().components.length <= 5, 'an action row went over 5 components');
    }
    assert.ok(msg.components.length <= 5, 'message went over 5 action rows');
  });

  test('manage mode offers Change Order and Change Writer', () => {
    const msg = buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, { ...cfg, ...manageCfg }, { manageMode: true });
    const ids = customIds(msg);
    assert.ok(ids.includes('story_edit_manage_order'));
    assert.ok(ids.includes('story_edit_manage_writer'));
  });

  // A deleted entry holds its slot in the reading order rather than occupying one, and crediting
  // it can wait until it is restored — so both change buttons are disabled, not hidden.
  test('both change buttons are disabled on a deleted entry', () => {
    const msg = buildEditMessage(
      singlePage(), 0, false, 7, 'My Story', 42, { ...cfg, ...manageCfg },
      { manageMode: true, entryStatus: 'deleted' }
    );
    const byId = Object.fromEntries(
      msg.components.flatMap(row => row.toJSON().components.map(c => [c.custom_id, c]))
    );
    assert.equal(byId.story_edit_manage_order.disabled, true);
    assert.equal(byId.story_edit_manage_writer.disabled, true);
    assert.equal(byId.story_edit_manage_restore.disabled, false);
  });

  test('neither change button is offered outside manage mode', () => {
    const ids = customIds(buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg));
    assert.ok(!ids.includes('story_edit_manage_order'));
    assert.ok(!ids.includes('story_edit_manage_writer'));
  });

  // The file round trip is for the writer with a long entry as much as for an admin, so it is
  // not gated on manage mode.
  test('the file round trip is offered to an author too', () => {
    const ids = customIds(buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, { ...cfg, ...manageCfg }, { fileRoundTrip: true }));
    assert.ok(ids.includes('story_edit_export_file'));
    assert.ok(ids.includes('story_edit_import_file'));
  });

  // story/read.js renders this panel inline from its own Edit button with EDIT_PANEL_CONFIG_KEYS
  // alone, so the file buttons must not appear there — they would render with no label and throw.
  // LeeAnn, 2026-10-22: "the Edit interface should not be rendered differently if accessed from
  // different places." The read path passes no options at all, so this is the check that the
  // panel it gets is the panel everything else gets.
  test('the file buttons are on the panel with no options passed at all', () => {
    const ids = customIds(buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg));
    assert.ok(ids.includes('story_edit_export_file'));
    assert.ok(ids.includes('story_edit_import_file'));
  });

  // The button used to be built in the save-an-edit path, so it appeared only after a save and
  // advancing worked exactly once. It belongs to the panel now, and the panel is built the same
  // way wherever the session was opened from.
  test('Edit Next Entry renders when the session resolved a next entry', () => {
    const msg = buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg, { nextEntryId: 918 });
    const tail = msg.components.at(-1).toJSON().components;
    assert.deepEqual(tail.map(c => c.custom_id),
      ['story_edit_export_file', 'story_edit_import_file', 'story_edit_next_entry_918']);
    assert.equal(tail.at(-1).label, 'Edit Next Entry →');
  });

  test('no Edit Next Entry at the end of the story, or for a non-admin', () => {
    const ids = customIds(buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, cfg));
    assert.ok(!ids.some(id => id.startsWith('story_edit_next_entry_')));
  });

  test('Back to List stays last in the tail row', () => {
    const msg = buildEditMessage(singlePage(), 0, false, 7, 'My Story', 42, { ...cfg, ...manageCfg }, { hasPicker: true, nextEntryId: 918 });
    const tail = msg.components.at(-1).toJSON().components;
    assert.deepEqual(tail.map(c => c.custom_id),
      ['story_edit_export_file', 'story_edit_import_file', 'story_edit_next_entry_918', 'story_edit_backlist']);
  });
});

describe('buildEntryModal', () => {
  const state = (chunks, chunkPage) => ({ entryId: 99, chunks, chunkPage, editCfg: cfg });

  test('nests the text input inside a label carrying the page hint', () => {
    const chunks = multiPage();
    const json = buildEntryModal(state(chunks, 1)).toJSON();
    const label = json.components[0];
    assert.equal(label.component.custom_id, 'entry_content');
    assert.equal(
      label.description,
      `Page 2 of ${chunks.length} · ${chunks[1].text.length} of ${EDIT_PAGE_LIMIT} characters used.`
    );
  });

  // The hint points at Add Page only where the button is, which is the last page.
  test('the Add Page sentence is on the last page and nowhere else', () => {
    const chunks = multiPage();
    const last = buildEntryModal(state(chunks, chunks.length - 1)).toJSON().components[0];
    assert.ok(last.description.endsWith('then use ➕ Add Page for more room.'));
    const middle = buildEntryModal(state(chunks, 1)).toJSON().components[0];
    assert.ok(!middle.description.includes('Add Page'));
  });

  test('the hint is a label description, not a placeholder', () => {
    // A placeholder never renders over a pre-filled value, which is why the previous
    // save-and-reopen hint was invisible. Guards against it regressing to one.
    const json = buildEntryModal(state(multiPage(), 0)).toJSON();
    assert.equal(json.components[0].component.placeholder, undefined);
    assert.ok(json.components[0].description);
  });

  test('hint stays well inside the 1024-character label-description cap', () => {
    const chunks = Array.from({ length: 200 }, () => ({ text: 'x'.repeat(EDIT_PAGE_LIMIT), start: 0, end: 760000 }));
    const json = buildEntryModal(state(chunks, 199)).toJSON();
    assert.ok(json.components[0].description.length <= 1024);
  });

  test('single-page entry gets no page suffix in the modal title', () => {
    assert.equal(buildEntryModal(state(singlePage(), 0)).toJSON().title, 'Edit Entry');
  });

  test('an empty added page opens with an empty value', () => {
    const json = buildEntryModal(state(withAddedPage(), 1)).toJSON();
    assert.equal(json.components[0].component.value, '');
  });

  test('carries the page in the customId so Discord cannot cache across pages', () => {
    const chunks = multiPage();
    const lastPage = chunks.length - 1;
    assert.equal(
      buildEntryModal(state(chunks, lastPage)).toJSON().custom_id,
      `story_edit_modal_99_p${lastPage}`
    );
  });
});

describe('added-page append semantics', () => {
  // Mirrors what handleEditModalSubmit does for an isNew chunk: append at the freshly-read
  // content length, with the paragraph break the page has no seam of its own to supply.
  const appended = (content, text) => {
    const needsBreak = !content ? '' : content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    return content + needsBreak + text;
  };

  test('separates appended text from the previous page with a paragraph break', () => {
    assert.equal(appended('End of prose.', 'New page.'), 'End of prose.\n\nNew page.');
  });
  test('does not stack breaks when the entry already ends with one', () => {
    assert.equal(appended('End of prose.\n\n', 'New page.'), 'End of prose.\n\nNew page.');
  });
  test('completes a single trailing newline rather than adding two', () => {
    assert.equal(appended('End of prose.\n', 'New page.'), 'End of prose.\n\nNew page.');
  });
  test('adds no leading break to an entry that is empty', () => {
    assert.equal(appended('', 'New page.'), 'New page.');
  });

  test('re-chunking the appended content keeps the new text reachable', () => {
    const content = appended('word '.repeat(2000), 'The appended page.');
    const chunks = chunkEntryContent(content);
    assert.ok(chunks[chunks.length - 1].text.includes('The appended page.'));
    assert.equal(chunks[chunks.length - 1].end, content.length);
  });
});
