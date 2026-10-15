import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtMs, overText } from '../src/components/Timer';

test('the stage clock counts down and stops at "Time\'s up", never negative', () => {
  assert.equal(fmtMs(5 * 60_000), '5:00');
  assert.equal(fmtMs(61_500), '1:02');
  assert.equal(fmtMs(1), '0:01');
  assert.equal(fmtMs(0), "Time's up");
  assert.equal(fmtMs(-61 * 60_000 - 9_000), "Time's up");
  assert.equal(overText(-20_000), 'Ended just now');
  assert.equal(overText(-61 * 60_000 - 9_000), 'Ended 61 min ago');
});
