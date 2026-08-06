export const CHIP_DENOMINATIONS = Object.freeze([500, 100, 20, 10, 5, 1]);

function emptyRack() {
  return Object.fromEntries([...CHIP_DENOMINATIONS].reverse().map((denomination) => [denomination, 0]));
}

function checkedAmount(amount) {
  const value = Number(amount);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Chip amount must be a non-negative integer');
  return value;
}

function copyRack(rack) {
  const copy = emptyRack();
  for (const denomination of CHIP_DENOMINATIONS) {
    const count = Number(rack?.[denomination] ?? 0);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid chip rack');
    copy[denomination] = count;
  }
  return copy;
}

export function chipRackValue(rack) {
  const checked = copyRack(rack);
  return CHIP_DENOMINATIONS.reduce(
    (total, denomination) => total + denomination * checked[denomination],
    0,
  );
}

export function addChips(rack, amount) {
  const credited = copyRack(rack);
  let remaining = checkedAmount(amount);
  for (const denomination of CHIP_DENOMINATIONS) {
    const count = Math.floor(remaining / denomination);
    credited[denomination] += count;
    remaining -= count * denomination;
  }
  return credited;
}

export function createChipRack(amount) {
  return addChips(emptyRack(), amount);
}

export function exchangeChip(rack, denomination) {
  const changed = copyRack(rack);
  const value = Number(denomination);
  const index = CHIP_DENOMINATIONS.indexOf(value);
  if (index < 0) throw new Error('Unknown chip denomination');
  if (index === CHIP_DENOMINATIONS.length - 1) throw new Error('The smallest chip cannot be changed');
  if (changed[value] < 1) throw new Error(`You do not have a ${value} chip to change`);
  const smaller = CHIP_DENOMINATIONS[index + 1];
  changed[value] -= 1;
  changed[smaller] += value / smaller;
  return changed;
}

export function spendChips(rack, amount) {
  let remaining = checkedAmount(amount);
  let available = copyRack(rack);
  if (remaining > chipRackValue(available)) throw new Error('Not enough chips');

  while (remaining > 0) {
    for (const denomination of CHIP_DENOMINATIONS) {
      const count = Math.min(available[denomination], Math.floor(remaining / denomination));
      available[denomination] -= count;
      remaining -= count * denomination;
    }
    if (remaining === 0) break;

    const denomination = [...CHIP_DENOMINATIONS]
      .reverse()
      .find((candidate) => candidate > remaining && available[candidate] > 0);
    if (!denomination) throw new Error('Cannot make exact change');
    available = exchangeChip(available, denomination);
  }

  return available;
}
