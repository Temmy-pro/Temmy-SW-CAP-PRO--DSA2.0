import { randomInt, randomUUID } from 'node:crypto';

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function newId() {
  return randomUUID();
}

export function newReference() {
  let reference = '';

  for (let index = 0; index < 10; index += 1) {
    reference += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }

  return `${reference.slice(0, 5)}-${reference.slice(5)}`;
}