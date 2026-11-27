// sync-config's orphan report and helper/cleanup.js's safety check.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isServerSavedSetting, findKeysInConfigFiles, readConfigFileEntries } from '../sync-config.js';

describe('isServerSavedSetting', () => {
  test('a cfg row a server saved for itself is not reported', () => {
    assert.equal(isServerSavedSetting({ config_key: 'cfgGroundRules', guild_id: '123456789012345678' }), true);
    assert.equal(isServerSavedSetting({ config_key: 'cfgStarterStoryId', guild_id: 42 }), true);
  });
  test('a leftover cfg row on the guild 1 default is still reported, string or number id', () => {
    assert.equal(isServerSavedSetting({ config_key: 'cfgWeeklyRoundupThumbnail', guild_id: 1 }), false);
    assert.equal(isServerSavedSetting({ config_key: 'cfgWeeklyRoundupThumbnail', guild_id: '1' }), false);
  });
  test('non-cfg keys are always reported', () => {
    assert.equal(isServerSavedSetting({ config_key: 'txtManageSaveWarning', guild_id: '123' }), false);
  });
});

describe('findKeysInConfigFiles', () => {
  const files = new Map([
    ['a.sql', [{ config_key: 'txtLive', guild_id: 1 }]],
    ['b.sql', [{ config_key: 'cfgLive', guild_id: 1 }]],
  ]);
  test('names the file of each listed key still declared', () => {
    const found = findKeysInConfigFiles(['txtLive', 'cfgLive', 'txtGone'], files);
    assert.deepEqual([...found], [['txtLive', 'a.sql'], ['cfgLive', 'b.sql']]);
  });
  test('the real cleanup list has no key still declared in the config files', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../helper/cleanup.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('const ORPHAN_KEYS = ['), src.indexOf('];'));
    const keys = [...block.matchAll(/^'([^']+)'/gm)].map(m => m[1]);
    assert.ok(keys.length > 50);
    const found = findKeysInConfigFiles(keys, readConfigFileEntries(new URL('../db/config_files', import.meta.url).pathname));
    assert.deepEqual([...found.keys()], []);
  });
});
