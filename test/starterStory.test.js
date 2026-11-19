import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickStarterGroundRules, buildStarterStoryInput, claimStarterStory, STARTER_MARKER,
} from '../story/_starterStory.js';
import { seedStarterOpening } from '../story/_starterOpening.js';
import { STORY_DEFAULTS } from '../story/_storyDefaults.js';
import { STORY_MODE, TURN_STATUS, ENTRY_STATUS } from '../constants.js';
import { makeFakeConnection } from './_fakeConnection.js';

const VOCAB = [
  { label: 'Anything Goes', description: '' },
  { label: "Respect Other Writers' Choices", description: '' },
  { label: 'Conflict, Not Contempt', description: '' },
];

describe('pickStarterGroundRules', () => {
  test('picks the wanted rules the server still has', () => {
    const { picked, missing } = pickStarterGroundRules('respect-other-writers-choices,conflict-not-contempt', VOCAB);
    assert.deepEqual(picked, ['respect-other-writers-choices', 'conflict-not-contempt']);
    assert.deepEqual(missing, []);
  });

  test('skips a rule the admin removed or renamed', () => {
    const vocab = VOCAB.filter((r) => r.label !== 'Conflict, Not Contempt');
    const { picked, missing } = pickStarterGroundRules('respect-other-writers-choices, conflict-not-contempt', vocab);
    assert.deepEqual(picked, ['respect-other-writers-choices']);
    assert.deepEqual(missing, ['conflict-not-contempt']);
  });

  test("'all' picks every rule the server has, in its order", () => {
    const { picked, missing } = pickStarterGroundRules('all', VOCAB);
    assert.deepEqual(picked, ['anything-goes', 'respect-other-writers-choices', 'conflict-not-contempt']);
    assert.deepEqual(missing, []);
  });

  test('an empty wanted list picks nothing', () => {
    assert.deepEqual(pickStarterGroundRules('', VOCAB), { picked: [], missing: [] });
  });
});

describe('buildStarterStoryInput', () => {
  const cfg = { txtStarterStoryTitle: 'The Fellowship of the Pen', txtStarterStorySummary: 'A summary' };

  test('slow mode, reminders off, no delay, shared defaults otherwise', () => {
    const input = buildStarterStoryInput(cfg, ['a', 'b'], 'Admin');
    assert.equal(input.storyTitle, 'The Fellowship of the Pen');
    assert.equal(input.mode, STORY_MODE.SLOW);
    assert.equal(input.timeoutReminder, 0);
    assert.equal(input.delayHours, null);
    assert.equal(input.delayWriters, null);
    assert.equal(input.orderType, STORY_DEFAULTS.orderType);
    assert.equal(input.rating, STORY_DEFAULTS.rating);
    assert.equal(input.penName, 'Admin');
    assert.equal(input.summary, 'A summary');
    assert.equal(input.groundRules, 'a,b');
  });

  test('no picked rules stores null, not an empty string', () => {
    assert.equal(buildStarterStoryInput(cfg, [], 'Admin').groundRules, null);
  });
});

describe('STORY_DEFAULTS', () => {
  test('Round Robin is the default turn order', () => {
    assert.equal(STORY_DEFAULTS.orderType, 2);
  });
});

// claimStarterStory's query sequence:
//  first setup: 1. INSERT IGNORE marker  (2. UPDATE pending -> creating, only if the insert hit a row)
//  later save:  1. UPDATE pending -> creating
describe('claimStarterStory', () => {
  test('first setup claims by inserting the marker', async () => {
    const conn = makeFakeConnection([{ affectedRows: 1 }]);
    assert.equal(await claimStarterStory(conn, '9', true), true);
    assert.equal(conn.calls.length, 1);
    assert.match(conn.calls[0].sql, /INSERT IGNORE INTO config/);
    assert.deepEqual(conn.calls[0].params, ['cfgStarterStoryId', STARTER_MARKER.CREATING, '9']);
  });

  test('first setup with a marker already there claims only a pending one', async () => {
    const conn = makeFakeConnection([{ affectedRows: 0 }, { affectedRows: 0 }]);
    assert.equal(await claimStarterStory(conn, '9', true), false);
    assert.match(conn.calls[1].sql, /UPDATE config SET config_value/);
    assert.deepEqual(conn.calls[1].params, [STARTER_MARKER.CREATING, 'cfgStarterStoryId', '9', STARTER_MARKER.PENDING]);
  });

  test('a later save never inserts, so existing servers never get one', async () => {
    const conn = makeFakeConnection([{ affectedRows: 0 }]);
    assert.equal(await claimStarterStory(conn, '9', false), false);
    assert.equal(conn.calls.length, 1);
    assert.doesNotMatch(conn.calls[0].sql, /INSERT/);
  });

  test('a later save retries a pending first attempt', async () => {
    const conn = makeFakeConnection([{ affectedRows: 1 }]);
    assert.equal(await claimStarterStory(conn, '9', false), true);
  });
});

// seedStarterOpening's query sequence:
//  1. INSERT story_writer  2. INSERT turn (ended)  3. SELECT next entry_order  4. INSERT story_entry
describe('seedStarterOpening', () => {
  test('writes the stranger, an ended turn and a confirmed Turn 1 entry', async () => {
    const conn = makeFakeConnection([
      { insertId: 70 },
      { insertId: 500 },
      [{ next_order: 1 }],
      {},
    ]);
    const writerId = await seedStarterOpening(conn, 45, 'bot-id', { strangerName: 'The Hooded Stranger', entryText: 'Once...' });
    assert.equal(writerId, 70);
    assert.deepEqual(conn.calls[0].params, [45, 'bot-id', 'The Hooded Stranger', 'The Hooded Stranger']);
    assert.deepEqual(conn.calls[1].params, [70, TURN_STATUS.ENDED]);
    assert.deepEqual(conn.calls[3].params, [500, 'Once...', ENTRY_STATUS.CONFIRMED, 1]);
  });
});
