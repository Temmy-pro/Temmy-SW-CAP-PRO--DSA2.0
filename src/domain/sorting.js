import { DomainError } from './errors.js';

export function mergeSort(items, compare) {
  if (!Array.isArray(items)) {
    throw new DomainError('Items must be an array.', 'VALIDATION');
  }

  if (typeof compare !== 'function') {
    throw new DomainError('Compare must be a function.', 'VALIDATION');
  }

  function sortRange(start, end, source, target) {
    if (end - start <= 1) {
      return;
    }

    const middle = Math.floor((start + end) / 2);
    sortRange(start, middle, target, source);
    sortRange(middle, end, target, source);

    let left = start;
    let right = middle;

    for (let index = start; index < end; index += 1) {
      if (left < middle && (right >= end || compare(source[left], source[right]) <= 0)) {
        target[index] = source[left];
        left += 1;
      } else {
        target[index] = source[right];
        right += 1;
      }
    }
  }

  const source = items.slice();
  const target = items.slice();
  sortRange(0, source.length, source, target);
  return target;
}