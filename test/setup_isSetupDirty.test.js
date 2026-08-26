import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isSetupDirty, STAGED_FIELDS } from '../commands/_storyadminSetup.js';

function makeState(overrides = {}) {
  const base = {
    feedChannelId: '111', mediaChannelId: '222', adminRoleName: 'Story Admin',
    restrictedFeedChannelId: '333', restrictedMediaChannelId: '444',
    roundupChannelId: '555', roundupDay: '1', roundupHour: '9', changelogEnabled: true,
  };
  const state = { ...base, ...overrides };
  state.originalFields = Object.fromEntries(STAGED_FIELDS.map((key) => [key, base[key]]));
  return state;
}

describe('isSetupDirty', () => {
  test('reports clean when nothing has changed from the snapshot', () => {
    const state = makeState();
    assert.equal(isSetupDirty(state), false);
  });

  test('reports dirty when the feed channel changed', () => {
    const state = makeState({ feedChannelId: '999' });
    assert.equal(isSetupDirty(state), true);
  });

  test('reports dirty when the admin role name changed', () => {
    const state = makeState({ adminRoleName: 'Moderator' });
    assert.equal(isSetupDirty(state), true);
  });

  test('reports dirty when the roundup channel/day/hour changed', () => {
    assert.equal(isSetupDirty(makeState({ roundupChannelId: '' })), true);
    assert.equal(isSetupDirty(makeState({ roundupDay: '3' })), true);
    assert.equal(isSetupDirty(makeState({ roundupHour: '14' })), true);
  });

  test('reports dirty when the changelog toggle changed', () => {
    const state = makeState({ changelogEnabled: false });
    assert.equal(isSetupDirty(state), true);
  });

  test('returns false when originalFields has not been snapshotted yet', () => {
    const state = makeState();
    delete state.originalFields;
    assert.equal(isSetupDirty(state), false);
  });
});
