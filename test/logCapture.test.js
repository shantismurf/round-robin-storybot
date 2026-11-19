import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFirstMinutesCapture, captureLogLine, clearFirstMinutesCaptures } from '../logCapture.js';

describe('first-minutes log capture', () => {
  afterEach(() => clearFirstMinutesCaptures());

  test('collects lines by guild name or id, and posts them when the window closes', async () => {
    let closed = null;
    startFirstMinutesCapture('555', 'Quill', (id, name, lines) => { closed = { id, name, lines }; }, 0.0005);
    captureLogLine('t1 (Quill): shantismurf triggered storyadmin setup', 'Quill');
    captureLogLine('t2: logGuildEvent: setup_saved for guild 555');
    captureLogLine('t3 (Other): unrelated', 'Other');
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(closed, {
      id: '555', name: 'Quill',
      lines: ['t1 (Quill): shantismurf triggered storyadmin setup', 't2: logGuildEvent: setup_saved for guild 555'],
    });
  });

  test('a second start for the same guild is ignored', () => {
    assert.equal(startFirstMinutesCapture('9', 'A', () => {}), true);
    assert.equal(startFirstMinutesCapture('9', 'A', () => {}), false);
  });

  test('nothing is collected when no capture is open', () => {
    assert.doesNotThrow(() => captureLogLine('line', 'Any'));
  });
});
