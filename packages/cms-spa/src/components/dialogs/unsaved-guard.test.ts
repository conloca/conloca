import { afterEach, describe, expect, test } from 'bun:test';
import { createFakeDocChannel } from '../../../test/fake-doc-channel.js';
import type { LiveStatus } from '../../live/messages.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { shouldBlockLeave } from './unsaved-guard.js';

const status = (pending: boolean, persisted: boolean): LiveStatus => ({
  connection: 'connected',
  pending,
  persisted,
  readOnly: null,
});

const previous = getUIConfig();
afterEach(() => configureUI(previous));

describe('shouldBlockLeave', () => {
  test('saving with Save, the editor dirty flag decides', () => {
    expect(shouldBlockLeave(null, true, false)).toBe(true);
    expect(shouldBlockLeave(null, false, false)).toBe(false);
  });

  test('an editor saving with Save inside a live frame keeps its dirty flag, whatever the channel status says', () => {
    expect(shouldBlockLeave(status(false, true), true, false)).toBe(true);
    expect(shouldBlockLeave(status(true, true), false, false)).toBe(false);
  });

  test('live edits the server has not acknowledged and this device has not kept block leaving', () => {
    expect(shouldBlockLeave(status(true, false), false, true)).toBe(true);
  });

  test('live edits kept on this device do not block, even while unacknowledged', () => {
    expect(shouldBlockLeave(status(true, true), true, true)).toBe(false);
  });

  test('live, with nothing pending the local dirty flag does not block', () => {
    expect(shouldBlockLeave(status(false, true), true, true)).toBe(false);
  });

  test('work held in the frame blocks even with nothing pending', () => {
    const fake = createFakeDocChannel({});
    configureUI({ ...previous, docChannel: { ...fake.channel, held: () => 'Held for the copy-out.' } });
    expect(shouldBlockLeave(status(false, true), false, true)).toBe(true);
  });

  test('work held in the frame blocks before the first live status arrives', () => {
    const fake = createFakeDocChannel({});
    configureUI({ ...previous, docChannel: { ...fake.channel, held: () => 'Held for the copy-out.' } });
    expect(shouldBlockLeave(null, false, true)).toBe(true);
  });
});
