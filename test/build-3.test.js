import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ALLOWED_TRANSITIONS, BOOKING_STATES, assertTransition, canTransition } from '../src/domain/bookingStateMachine.js';
import { DomainError } from '../src/domain/errors.js';
import { getPort } from '../src/config.js';
import { createApp } from '../src/http/app.js';
import { createRouter } from '../src/http/router.js';

const states = Object.values(BOOKING_STATES);
const allowedMoves = [
  ['pending', 'paid'],
  ['pending', 'cancelled'],
  ['paid', 'checked_in'],
  ['paid', 'refunded'],
  ['paid', 'cancelled'],
];

test('booking state machine allows every specified move', () => {
  for (const [from, to] of allowedMoves) {
    assert.equal(canTransition(from, to), true);
    assert.equal(assertTransition(from, to), true);
  }
});

test('booking state machine rejects every unspecified move', () => {
  const allowed = new Set(allowedMoves.map(([from, to]) => `${from}:${to}`));

  for (const from of states) {
    for (const to of states) {
      if (allowed.has(`${from}:${to}`)) {
        continue;
      }

      assert.equal(canTransition(from, to), false, `${from} -> ${to}`);
      assert.throws(
        () => assertTransition(from, to),
        (error) => error instanceof DomainError && error.code === 'INVALID_TRANSITION',
      );
    }
  }
});

test('terminal states have no outgoing transitions', () => {
  for (const state of ['cancelled', 'refunded', 'checked_in']) {
    assert.deepEqual(ALLOWED_TRANSITIONS[state], []);
  }
});

test('router matches method and path parameters', () => {
  const router = createRouter();
  const handler = () => ({ ok: true });
  router.add('GET', '/events/:eventId/bookings/:bookingId', handler);

  const match = router.match('GET', '/events/event-123/bookings/booking-456');
  assert.equal(match.handler, handler);
  assert.deepEqual(match.params, { eventId: 'event-123', bookingId: 'booking-456' });
  assert.equal(router.match('POST', '/events/event-123/bookings/booking-456'), null);
  assert.equal(router.match('GET', '/events/event-123'), null);
});

test('router rejects malformed definitions and duplicate routes', () => {
  const router = createRouter();

  assert.throws(() => router.add('GET', 'events', () => null), (error) => error.code === 'VALIDATION');
  assert.throws(() => router.add('GET', '/events/:', () => null), (error) => error.code === 'VALIDATION');
  router.add('GET', '/health-check', () => null);
  assert.throws(() => router.add('get', '/health-check', () => null), (error) => error.code === 'VALIDATION');
});

test('PORT defaults to 3000 and validates configured values', () => {
  assert.equal(getPort({}), 3000);
  assert.equal(getPort({ PORT: '4321' }), 4321);
  assert.throws(() => getPort({ PORT: '70000' }), RangeError);
});

async function withServer(options, run) {
  const server = createServer(createApp(options));
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    });
  }
}

test('HTTP server returns JSON from a real GET /health request', async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});

test('unknown API routes and malformed JSON use the standard JSON error envelope', async () => {
  await withServer({}, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/no-such-route`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: { code: 'NOT_FOUND', message: 'API route was not found.' },
    });

    const badJson = await fetch(`${baseUrl}/api/example`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(badJson.status, 400);
    assert.deepEqual(await badJson.json(), {
      error: { code: 'VALIDATION', message: 'Request body contains invalid JSON.' },
    });
  });
});

test('HTTP server serves files under publicDir and blocks encoded traversal', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'ticketing-public-'));
  const publicDir = join(temporaryRoot, 'public');
  await mkdir(publicDir);
  await writeFile(join(publicDir, 'index.html'), '<h1>Ticketing</h1>');
  await writeFile(join(temporaryRoot, 'private.txt'), 'private');

  try {
    await withServer({ publicDir }, async (baseUrl) => {
      const page = await fetch(baseUrl);
      assert.equal(page.status, 200);
      assert.equal(await page.text(), '<h1>Ticketing</h1>');

      const traversal = await fetch(`${baseUrl}/..%2Fprivate.txt`);
      assert.equal(traversal.status, 404);
      assert.deepEqual(await traversal.json(), {
        error: { code: 'NOT_FOUND', message: 'File was not found.' },
      });

      const malformedPath = await fetch(`${baseUrl}/%E0%A4%A`);
      assert.equal(malformedPath.status, 400);
      assert.deepEqual(await malformedPath.json(), {
        error: { code: 'VALIDATION', message: 'Request path is invalid.' },
      });
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});