import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMentionsToPlainText } from '../story/_entryMarkup.js';

const cfg = {
  txtExportPlaceholderUser: '@unknown',
  txtExportPlaceholderChannel: '#unknown',
  txtExportPlaceholderRole: '@unknown',
};

// Minimal fake guild — only the surface resolveMentionsToPlainText actually touches.
function makeFakeGuild({ members = {}, channels = {}, roles = {} } = {}) {
  return {
    members: {
      async fetch(id) {
        if (members[id]) return { displayName: members[id] };
        throw new Error('Unknown Member');
      },
    },
    channels: { cache: new Map(Object.entries(channels).map(([id, name]) => [id, { name }])) },
    roles: { cache: new Map(Object.entries(roles).map(([id, name]) => [id, { name }])) },
  };
}

describe('resolveMentionsToPlainText', () => {
  test('no guild — every mention type falls back to the configured placeholder', async () => {
    const result = await resolveMentionsToPlainText('Hi <@123> in <#456> as <@&789>', null, cfg);
    assert.equal(result, 'Hi @unknown in #unknown as @unknown');
  });

  test('no guild, no cfg — falls back to the literal bracketed default', async () => {
    const result = await resolveMentionsToPlainText('Hi <@123>', null, {});
    assert.equal(result, 'Hi @[user]');
  });

  test('resolves a user mention to their display name when the guild has them', async () => {
    const guild = makeFakeGuild({ members: { '123': 'Story Writer' } });
    const result = await resolveMentionsToPlainText('Hi <@123>!', guild, cfg);
    assert.equal(result, 'Hi @Story Writer!');
  });

  test('resolves the nickname-mention form <@!id> the same as <@id>', async () => {
    const guild = makeFakeGuild({ members: { '123': 'Story Writer' } });
    const result = await resolveMentionsToPlainText('Hi <@!123>!', guild, cfg);
    assert.equal(result, 'Hi @Story Writer!');
  });

  test('falls back to the placeholder when a member fetch fails (left server, deleted, etc.)', async () => {
    const guild = makeFakeGuild({ members: {} });
    const result = await resolveMentionsToPlainText('Hi <@999>!', guild, cfg);
    assert.equal(result, 'Hi @unknown!');
  });

  test('never falls back to the raw numeric ID', async () => {
    const guild = makeFakeGuild({});
    const result = await resolveMentionsToPlainText('<@999> <#888> <@&777>', guild, cfg);
    assert.doesNotMatch(result, /\d{3,}/);
  });

  test('resolves a channel mention to its name when cached', async () => {
    const guild = makeFakeGuild({ channels: { '456': 'general' } });
    const result = await resolveMentionsToPlainText('See <#456>', guild, cfg);
    assert.equal(result, 'See #general');
  });

  test('falls back to the placeholder for an unresolvable channel (deleted, hidden/obfuscated, cache miss)', async () => {
    const guild = makeFakeGuild({ channels: {} });
    const result = await resolveMentionsToPlainText('See <#456>', guild, cfg);
    assert.equal(result, 'See #unknown');
  });

  test('resolves a role mention to its name when cached', async () => {
    const guild = makeFakeGuild({ roles: { '789': 'Beta Readers' } });
    const result = await resolveMentionsToPlainText('Ping <@&789>', guild, cfg);
    assert.equal(result, 'Ping @Beta Readers');
  });

  test('falls back to the placeholder for an unresolvable role', async () => {
    const guild = makeFakeGuild({ roles: {} });
    const result = await resolveMentionsToPlainText('Ping <@&789>', guild, cfg);
    assert.equal(result, 'Ping @unknown');
  });

  test('is idempotent — already-resolved plain text passes through unchanged', async () => {
    const guild = makeFakeGuild({ members: { '123': 'Story Writer' } });
    const once = await resolveMentionsToPlainText('Hi <@123>!', guild, cfg);
    const twice = await resolveMentionsToPlainText(once, guild, cfg);
    assert.equal(once, twice);
  });

  test('text with no mention tokens passes through unchanged, with or without a guild', async () => {
    const plain = 'Just an ordinary sentence with no mentions at all.';
    assert.equal(await resolveMentionsToPlainText(plain, null, cfg), plain);
    assert.equal(await resolveMentionsToPlainText(plain, makeFakeGuild(), cfg), plain);
  });

  test('resolves multiple mentions of the same user without duplicate fetches', async () => {
    let fetchCount = 0;
    const guild = {
      members: {
        async fetch(id) {
          fetchCount++;
          return { displayName: 'Story Writer' };
        },
      },
      channels: { cache: new Map() },
      roles: { cache: new Map() },
    };
    const result = await resolveMentionsToPlainText('<@123> said hi to <@123> again', guild, cfg);
    assert.equal(result, '@Story Writer said hi to @Story Writer again');
    assert.equal(fetchCount, 1);
  });
});
