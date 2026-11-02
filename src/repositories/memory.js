function copy(record) {
  return record === undefined ? undefined : { ...record };
}

export function createMemoryRepository() {
  const events = new Map();
  const tiers = new Map();
  const bookings = new Map();
  const bookingsByReference = new Map();

  return {
    async saveEvent(event) {
      events.set(event.id, copy(event));
      return copy(event);
    },

    async getEvent(id) {
      return copy(events.get(id));
    },

    async listEvents() {
      return Array.from(events.values(), copy);
    },

    async saveTier(tier) {
      tiers.set(tier.id, copy(tier));
      return copy(tier);
    },

    async getTier(id) {
      return copy(tiers.get(id));
    },

    async listTiers(eventId) {
      return Array.from(tiers.values())
        .filter((tier) => eventId === undefined || tier.eventId === eventId)
        .map(copy);
    },

    async saveBooking(booking) {
      bookings.set(booking.id, copy(booking));
      bookingsByReference.set(booking.reference, booking.id);
      return copy(booking);
    },

    async getBookingByReference(reference) {
      const id = bookingsByReference.get(reference);
      return copy(id === undefined ? undefined : bookings.get(id));
    },

    async listBookings() {
      return Array.from(bookings.values(), copy);
    },
  };
}
