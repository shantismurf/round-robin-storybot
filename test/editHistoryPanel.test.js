import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderHistoryPage } from '../story/_editHistory.js';
import { makeFakeConnection } from './_fakeConnection.js';
import { EDIT_CHANGE_TYPE } from '../constants.js';

// The real values from db/config_files/config_turn.sql and config_story.sql. Kept literal so a
// wording change there can't quietly change what these assertions test.
const editCfg = {
  txtEditHistoryVersionTitle: 'Edit History — Version [version] of [total]{? · Page [page] of [pages]?}',
  txtEditHistoryEditedBy: 'Edited by [edited_by] · [edited_at]',
  txtEditHistoryChangeTitle: 'Entry History — Change [version] of [total]',
  txtEditHistoryChangeBy: 'Changed by [edited_by] · [edited_at]',
  txtEditHistoryWriterChanged: 'Writer changed from **[from_writer]** to **[to_writer]**.',
  txtEditHistoryMoved: 'Moved from turn [from_position] to turn [to_position].',
  txtEditRestoreWarningMulti: '*Multi-page warning.*',
  txtEditRestoreWarningSingle: '*Single-page warning.*',
  btnEditHistNewer: '← Newer',
  btnEditHistPrevPage: '← Prev Page',
  btnEditRestore: 'Restore This Version',
  btnEditHistNextPage: 'Next Page →',
  btnEditHistOlder: 'Older →',
  btnEditBackToEntry: '← Back to Entry',
};

const baseRow = {
  edit_id: 55,
  content: null,
  edited_by_name: 'LeeAnn',
  edited_at: '2026-10-22 01:08:00',
  change_type: null,
  previous_writer_name: null,
  new_writer_name: null,
  previous_position: null,
  new_position: null,
};

const render = (row, total, histPage = 0, histChunkPage = 0) => renderHistoryPage(
  makeFakeConnection([[{ ...baseRow, ...row }], [{ cnt: total }]]),
  null,
  { entryId: 4417, editCfg },
  histPage,
  histChunkPage
);

const buttons = msg => Object.fromEntries(
  msg.components.flatMap(row => row.toJSON().components.map(c => [c.custom_id, c]))
);

describe('renderHistoryPage — content version', () => {
  test('a single-page version titles itself a version and offers Restore', async () => {
    const msg = await render({ content: 'Once upon a time.' }, 1);
    const embed = msg.embeds[0].toJSON();
    assert.equal(embed.title, 'Edit History — Version 1 of 1');
    assert.equal(embed.description, 'Once upon a time.');
    assert.equal(embed.footer.text, 'Edited by LeeAnn · 2026-10-22 01:08:00');
    assert.equal(embed.fields[0].value, '*Single-page warning.*');
    assert.equal(buttons(msg).story_edit_restore_55.disabled, false);
  });

  test('version numbers count down from the newest row', async () => {
    const msg = await render({ content: 'Older text.' }, 4, 2);
    assert.equal(msg.embeds[0].toJSON().title, 'Edit History — Version 2 of 4');
  });
});

describe('renderHistoryPage — change rows', () => {
  test('a writer change says who it moved between', async () => {
    const msg = await render({
      change_type: EDIT_CHANGE_TYPE.REASSIGN,
      previous_writer_name: 'Maria',
      new_writer_name: 'Jun',
    }, 3);
    const embed = msg.embeds[0].toJSON();
    assert.equal(embed.title, 'Entry History — Change 3 of 3');
    assert.equal(embed.description, 'Writer changed from **Maria** to **Jun**.');
    assert.equal(embed.footer.text, 'Changed by LeeAnn · 2026-10-22 01:08:00');
  });

  test('a reorder says which turn numbers it moved between', async () => {
    const msg = await render({
      change_type: EDIT_CHANGE_TYPE.REORDER,
      previous_position: 5,
      new_position: 2,
    }, 1);
    assert.equal(msg.embeds[0].toJSON().description, 'Moved from turn 5 to turn 2.');
  });

  // LeeAnn, 2026-10-22: a move or a writer change is set again with the button that set it, so
  // there is nothing to undo here. The button is disabled rather than hidden so the row still
  // reads as part of the same history.
  test('Restore is shown but disabled, and there is nothing to page through', async () => {
    const msg = await render({
      change_type: EDIT_CHANGE_TYPE.REORDER, previous_position: 5, new_position: 2,
    }, 2);
    const ids = buttons(msg);
    assert.equal(ids.story_edit_restore_55.disabled, true);
    assert.ok(!('story_edit_hist_chunk_next' in ids));
    assert.ok(!('story_edit_hist_chunk_prev' in ids));
    // Browsing to the neighbouring rows still works.
    assert.ok('story_edit_history_next' in ids);
    assert.ok('story_edit_back' in ids);
  });

  test('a change row carries no restore warning, having no content to replace', async () => {
    const msg = await render({
      change_type: EDIT_CHANGE_TYPE.REORDER, previous_position: 1, new_position: 2,
    }, 1);
    assert.equal(msg.embeds[0].toJSON().fields, undefined);
  });

  // A change row arrived at with a stale chunk page must not try to render page 3 of nothing.
  test('a stale chunk page does not break a change row', async () => {
    const msg = await render({
      change_type: EDIT_CHANGE_TYPE.REASSIGN, previous_writer_name: 'Maria', new_writer_name: 'Jun',
    }, 3, 1, 2);
    assert.equal(msg.embeds[0].toJSON().title, 'Entry History — Change 2 of 3');
  });
});
