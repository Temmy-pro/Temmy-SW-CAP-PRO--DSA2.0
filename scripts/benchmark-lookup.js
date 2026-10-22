import { performance } from 'node:perf_hooks';

const BOOKINGS = 100_000;
const LOOKUPS = 500;
const bookings = [];
const bookingsByReference = new Map();

for (let index = 0; index < BOOKINGS; index += 1) {
  const booking = { reference: `REF-${index}`, id: index };
  bookings.push(booking);
  bookingsByReference.set(booking.reference, booking);
}

const references = Array.from({ length: LOOKUPS }, (_, index) => {
  const targetIndex = Math.floor(((index + 1) * BOOKINGS) / LOOKUPS) - 1;
  return `REF-${targetIndex}`;
});

let checksum = 0;
let startedAt = performance.now();
for (const reference of references) {
  checksum += bookings.find((booking) => booking.reference === reference).id;
}
const arrayFindMilliseconds = performance.now() - startedAt;

startedAt = performance.now();
for (const reference of references) {
  checksum += bookingsByReference.get(reference).id;
}
const mapGetMilliseconds = performance.now() - startedAt;

console.log(`Bookings: ${BOOKINGS.toLocaleString()}, lookups: ${LOOKUPS.toLocaleString()}`);
console.log(`Array.find: ${arrayFindMilliseconds.toFixed(2)} ms`);
console.log(`Map.get:    ${mapGetMilliseconds.toFixed(2)} ms`);
console.log(`Checksum:   ${checksum}`);