import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/http/app.js';

async function withServer(run) {
  const server = createServer(createApp());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function request(baseUrl, path, { method = 'GET', userId, body } = {}) {
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('Build 4 API creates and publishes events, adds tiers, and searches them', async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, '/api/events', {
      method: 'POST',
      userId: 'organizer-1',
      body: { title: 'Lagos Tech Meetup', city: 'Lagos', venue: 'Central Hall', date: '2026-12-05' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'DRAFT');
    assert.equal(created.body.organizerId, 'organizer-1');

    const draftSearch = await request(baseUrl, '/api/events?q=meetup');
    assert.deepEqual(draftSearch.body, []);

    const tier = await request(baseUrl, `/api/events/${created.body.id}/tiers`, {
      method: 'POST',
      userId: 'organizer-1',
      body: { name: 'General', priceCents: 500000, capacity: 3 },
    });
    assert.equal(tier.status, 201);
    assert.equal(tier.body.available, 3);

    const published = await request(baseUrl, `/api/events/${created.body.id}/publish`, {
      method: 'POST',
      userId: 'organizer-1',
    });
    assert.equal(published.status, 200);
    assert.equal(published.body.status, 'PUBLISHED');

    const found = await request(baseUrl, '/api/events?q=MEETUP&city=lagos&maxPriceCents=500000&onlyAvailable=true&sortBy=price');
    assert.equal(found.status, 200);
    assert.equal(found.body.length, 1);
    assert.equal(found.body[0].tiers[0].priceCents, 500000);

    const badSearch = await request(baseUrl, '/api/events?sortBy=unknown');
    assert.equal(badSearch.status, 400);
    assert.equal(badSearch.body.error.code, 'VALIDATION');
  });
});

test('Build 4 API books tickets, leaves declined payments pending, and pays only once by the owner', async () => {
  await withServer(async (baseUrl) => {
    const event = await request(baseUrl, '/api/events', {
      method: 'POST',
      userId: 'organizer-1',
      body: { title: 'Jazz Night', city: 'Abuja', venue: 'Jazz Hall', date: '2026-12-06' },
    });
    const tier = await request(baseUrl, `/api/events/${event.body.id}/tiers`, {
      method: 'POST',
      userId: 'organizer-1',
      body: { name: 'Standard', priceCents: 2500, capacity: 2 },
    });
    await request(baseUrl, `/api/events/${event.body.id}/publish`, {
      method: 'POST',
      userId: 'organizer-1',
    });

    const booking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      userId: 'attendee-1',
      body: { eventId: event.body.id, tierId: tier.body.id, quantity: 2 },
    });
    assert.equal(booking.status, 201);
    assert.equal(booking.body.status, 'PENDING');
    assert.equal(booking.body.totalCents, 5000);

    const fullTierSearch = await request(baseUrl, '/api/events?onlyAvailable=true');
    assert.deepEqual(fullTierSearch.body, []);

    const wrongOwner = await request(baseUrl, `/api/bookings/${booking.body.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-2',
    });
    assert.equal(wrongOwner.status, 403);
    assert.equal(wrongOwner.body.error.code, 'FORBIDDEN');

    const declined = await request(baseUrl, `/api/bookings/${booking.body.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
      body: { decline: true },
    });
    assert.equal(declined.status, 402);
    assert.equal(declined.body.error.code, 'PAYMENT_DECLINED');

    const paid = await request(baseUrl, `/api/bookings/${booking.body.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
      body: { decline: false },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'PAID');

    const repeatPayment = await request(baseUrl, `/api/bookings/${booking.body.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
    });
    assert.equal(repeatPayment.status, 400);
    assert.equal(repeatPayment.body.error.code, 'INVALID_TRANSITION');
  });
});

test('Build 4 API validates event and booking rules and cancels unpaid bookings', async () => {
  await withServer(async (baseUrl) => {
    const invalidEvent = await request(baseUrl, '/api/events', {
      method: 'POST',
      userId: 'organizer-1',
      body: { title: 'Bad date', city: 'Lagos', venue: 'Hall', date: '2026-02-30' },
    });
    assert.equal(invalidEvent.status, 400);
    assert.equal(invalidEvent.body.error.code, 'VALIDATION');

    const missingIdentity = await request(baseUrl, '/api/events', {
      method: 'POST',
      body: { title: 'Missing owner', city: 'Lagos', venue: 'Hall', date: '2026-12-05' },
    });
    assert.equal(missingIdentity.body.error.code, 'VALIDATION');

    const event = await request(baseUrl, '/api/events', {
      method: 'POST',
      userId: 'organizer-1',
      body: { title: 'Unpaid event', city: 'Lagos', venue: 'Hall', date: '2026-12-05' },
    });
    const noTierPublish = await request(baseUrl, `/api/events/${event.body.id}/publish`, {
      method: 'POST',
      userId: 'organizer-1',
    });
    assert.equal(noTierPublish.body.error.code, 'INVALID_STATE');

    const tier = await request(baseUrl, `/api/events/${event.body.id}/tiers`, {
      method: 'POST',
      userId: 'organizer-1',
      body: { name: 'General', priceCents: 100, capacity: 2 },
    });
    const published = await request(baseUrl, `/api/events/${event.body.id}/publish`, {
      method: 'POST',
      userId: 'organizer-1',
    });
    assert.equal(published.status, 200);

    const tooMany = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      userId: 'attendee-1',
      body: { eventId: event.body.id, tierId: tier.body.id, quantity: 11 },
    });
    assert.equal(tooMany.body.error.code, 'VALIDATION');

    const booking = await request(baseUrl, '/api/bookings', {
      method: 'POST',
      userId: 'attendee-1',
      body: { eventId: event.body.id, tierId: tier.body.id, quantity: 1 },
    });
    const cancelled = await request(baseUrl, `/api/bookings/${booking.body.reference}/cancel`, {
      method: 'POST',
      userId: 'attendee-1',
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.status, 'CANCELLED');

    const payCancelled = await request(baseUrl, `/api/bookings/${booking.body.reference}/pay`, {
      method: 'POST',
      userId: 'attendee-1',
    });
    assert.equal(payCancelled.body.error.code, 'INVALID_TRANSITION');
    const availableAgain = await request(baseUrl, '/api/events?onlyAvailable=true');
    assert.equal(availableAgain.body[0].tiers[0].available, 2);
  });
});
