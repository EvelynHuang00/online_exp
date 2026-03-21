import { SNACKS, EXPERIMENT } from "./config.js";

function allPairs(items) {
  const pairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) pairs.push([items[i], items[j]]);
  }
  return pairs;
}

function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildTrials(snacks = SNACKS) {
  const basePairs = allPairs(snacks);
  const trials = [];

  for (let rep = 0; rep < EXPERIMENT.REPEAT_BINARY_CHOICES; rep++) {
    for (const [a, b] of shuffle(basePairs)) {
      const flip = Math.random() < 0.5;
      const left = flip ? a : b;
      const right = flip ? b : a;

      trials.push({
        pair_id: `${a.id}__${b.id}`,
        left_item_id: left.id,
        right_item_id: right.id,
      });
    }
  }
  return trials;
}