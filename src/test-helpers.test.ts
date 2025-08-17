import { describe, expect, test } from 'bun:test';
import { DEADLOCK_ERROR, withFakeTimers } from './test-helpers';

describe('withFakeTimers', () => {
  test('Forever-blocking promise', async () => {
    expect(
      withFakeTimers(async () => {
        await new Promise(() => {});
      })
    ).rejects.toThrow(DEADLOCK_ERROR);
  });
});
