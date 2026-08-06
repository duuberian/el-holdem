import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addChips,
  chipRackValue,
  createChipRack,
  exchangeChip,
  spendChips,
} from '../server/chips.js';

describe('virtual poker chips', () => {
  it('represents an amount without creating or losing value', () => {
    const rack = createChipRack(1000);
    assert.equal(chipRackValue(rack), 1000);
    assert.deepEqual(rack, { 1: 0, 5: 0, 10: 0, 20: 0, 100: 0, 500: 2 });
  });

  it('changes one chip into the next smaller denomination', () => {
    const changed = exchangeChip(createChipRack(1000), 500);
    assert.equal(changed[500], 1);
    assert.equal(changed[100], 5);
    assert.equal(chipRackValue(changed), 1000);
  });

  it('automatically makes exact change when spending', () => {
    const remaining = spendChips(createChipRack(1000), 10);
    assert.equal(chipRackValue(remaining), 990);
    assert.equal(remaining[500], 1);
    assert.equal(remaining[10], 1);
  });

  it('adds winnings without changing existing lower chips', () => {
    const rack = { 1: 0, 5: 2, 10: 1, 20: 0, 100: 0, 500: 0 };
    const credited = addChips(rack, 100);
    assert.equal(credited[5], 2);
    assert.equal(credited[10], 1);
    assert.equal(credited[100], 1);
    assert.equal(chipRackValue(credited), 120);
  });

  it('rejects impossible exchanges and overspending', () => {
    assert.throws(() => exchangeChip(createChipRack(100), 500), /do not have/);
    assert.throws(() => exchangeChip(createChipRack(100), 1), /smallest/);
    assert.throws(() => spendChips(createChipRack(100), 101), /enough chips/);
  });
});
