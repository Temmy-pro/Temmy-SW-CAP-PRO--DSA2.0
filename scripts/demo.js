import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  findBookingByReference,
  joinWaitlist,
} from '../src/domain/inventory.js';

const store = createStore();
const event = createEvent(store, {
  title: 'Summer Sounds',
  city: 'Lagos',
  venue: 'Freedom Park',
  date: '2026-12-12',
});
const tier = addTier(store, event.id, {
  name: 'General Admission',
  priceCents: 250000,
  capacity: 3,
});

console.log(`${event.title} at ${event.venue}: ${tier.capacity} tickets available.`);

const adaBooking = bookTickets(store, {
  eventId: event.id,
  tierId: tier.id,
  attendeeName: 'Ada',
  quantity: 2,
});
console.log(`Ada booked 2 tickets. Reference: ${adaBooking.reference}. ${tier.available} left.`);

try {
  bookTickets(store, {
    eventId: event.id,
    tierId: tier.id,
    attendeeName: 'Bayo',
    quantity: 2,
  });
} catch (error) {
  console.log(`Bayo's request for 2 was refused: ${error.code} (${tier.available} ticket left).`);
}

const bayoBooking = bookTickets(store, {
  eventId: event.id,
  tierId: tier.id,
  attendeeName: 'Bayo',
  quantity: 1,
});
console.log(`Bayo booked the last ticket. Event sold out; reference: ${bayoBooking.reference}.`);

joinWaitlist(store, { tierId: tier.id, attendeeName: 'Chidi' });
joinWaitlist(store, { tierId: tier.id, attendeeName: 'Dara' });
console.log('Chidi and Dara joined the waitlist in that order.');

console.log(`Lookup by reference found ${findBookingByReference(store, adaBooking.reference).attendeeName}.`);
cancelBooking(store, adaBooking.reference);
const next = store.waitlists.get(tier.id).peek();
console.log(`Ada cancelled; ${tier.available} seats are available. Next in line: ${next.attendeeName}.`);