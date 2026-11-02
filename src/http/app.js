import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from '../domain/errors.js';
import { createMemoryRepository } from '../repositories/memory.js';
import { addTier, createEvent, publishEvent, searchPublishedEvents } from '../services/eventService.js';
import { cancelUnpaidBooking, createBooking, payForBooking } from '../services/bookingService.js';
import { mockPaymentGateway } from '../lib/mockPaymentGateway.js';
import { createRouter } from './router.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const MAX_JSON_BYTES = 1_048_576;
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function errorStatus(error) {
  if (error.code === 'NOT_FOUND') return 404;
  if (error.code === 'PAYLOAD_TOO_LARGE') return 413;
  if (error.code === 'METHOD_NOT_ALLOWED') return 405;
  if (error.code === 'FORBIDDEN') return 403;
  if (error.code === 'PAYMENT_DECLINED') return 402;
  if (error instanceof DomainError) return 400;
  return 500;
}

function sendError(response, error) {
  const statusCode = errorStatus(error);
  const code = error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
  const message = statusCode === 500 ? 'An internal server error occurred.' : error.message;
  sendJson(response, statusCode, { error: { code, message } });
}

async function readJsonBody(request) {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return undefined;
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BYTES) {
      throw new DomainError('JSON request body is too large.', 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }

  if (totalBytes === 0) {
    throw new DomainError('JSON request body is empty.', 'VALIDATION');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('Request body contains invalid JSON.', 'VALIDATION');
  }
}

function isInsideDirectory(directory, target) {
  const relativePath = relative(directory, target);
  return relativePath === ''
    || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath));
}

async function serveStatic(request, response, pathname, publicDir) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new DomainError('Only GET and HEAD are supported for static files.', 'METHOD_NOT_ALLOWED');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new DomainError('Request path is invalid.', 'VALIDATION');
  }

  if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
    throw new DomainError('File was not found.', 'NOT_FOUND');
  }

  const root = await realpath(publicDir);
  let candidate = resolve(root, `.${decodedPath}`);
  if (!isInsideDirectory(root, candidate)) {
    throw new DomainError('File was not found.', 'NOT_FOUND');
  }

  let fileInfo;
  try {
    fileInfo = await stat(candidate);
  } catch {
    throw new DomainError('File was not found.', 'NOT_FOUND');
  }

  if (fileInfo.isDirectory()) {
    candidate = resolve(candidate, 'index.html');
    try {
      fileInfo = await stat(candidate);
    } catch {
      throw new DomainError('File was not found.', 'NOT_FOUND');
    }
  }

  let canonicalFile;
  try {
    canonicalFile = await realpath(candidate);
  } catch {
    throw new DomainError('File was not found.', 'NOT_FOUND');
  }

  if (!isInsideDirectory(root, canonicalFile) || !fileInfo.isFile()) {
    throw new DomainError('File was not found.', 'NOT_FOUND');
  }

  response.writeHead(200, {
    'content-length': fileInfo.size,
    'content-type': CONTENT_TYPES[extname(canonicalFile).toLowerCase()] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  await new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(canonicalFile);
    stream.on('error', rejectStream);
    response.on('error', rejectStream);
    response.on('finish', resolveStream);
    stream.pipe(response);
  });
}

function requireJsonObject(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new DomainError('Request body must be a JSON object.', 'VALIDATION');
  }
  return body;
}

function requireQueryInteger(value, label) {
  if (!/^\d+$/.test(value)) {
    throw new DomainError(`${label} must be a non-negative whole number of cents.`, 'VALIDATION');
  }

  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new DomainError(`${label} must be a non-negative whole number of cents.`, 'VALIDATION');
  }
  return number;
}

function requireQueryBoolean(value, label) {
  if (value !== 'true' && value !== 'false') {
    throw new DomainError(`${label} must be true or false.`, 'VALIDATION');
  }
  return value === 'true';
}

function registerApiRoutes(router, repository, paymentGateway) {
  router.add('POST', '/api/events', async ({ request, body }) => ({
    status: 201,
    body: await createEvent(repository, request.headers['x-user-id'], requireJsonObject(body)),
  }));
  router.add('POST', '/api/events/:id/tiers', async ({ request, params, body }) => ({
    status: 201,
    body: await addTier(repository, params.id, request.headers['x-user-id'], requireJsonObject(body)),
  }));
  router.add('POST', '/api/events/:id/publish', async ({ request, params }) => ({
    body: await publishEvent(repository, params.id, request.headers['x-user-id']),
  }));
  router.add('GET', '/api/events', async ({ url }) => {
    const criteria = {};
    for (const key of ['q', 'city', 'from', 'to']) {
      if (url.searchParams.has(key)) criteria[key] = url.searchParams.get(key);
    }
    if (url.searchParams.has('maxPriceCents')) {
      criteria.maxPriceCents = requireQueryInteger(url.searchParams.get('maxPriceCents'), 'Maximum price');
    }
    if (url.searchParams.has('onlyAvailable')) {
      criteria.onlyAvailable = requireQueryBoolean(url.searchParams.get('onlyAvailable'), 'onlyAvailable');
    }

    return {
      body: await searchPublishedEvents(repository, criteria, url.searchParams.get('sortBy') ?? 'date'),
    };
  });
  router.add('POST', '/api/bookings', async ({ request, body }) => ({
    status: 201,
    body: await createBooking(repository, request.headers['x-user-id'], requireJsonObject(body)),
  }));
  router.add('POST', '/api/bookings/:reference/pay', async ({ request, params, body }) => ({
    body: await payForBooking(
      repository,
      paymentGateway,
      params.reference,
      request.headers['x-user-id'],
      body === undefined ? {} : requireJsonObject(body),
    ),
  }));
  router.add('POST', '/api/bookings/:reference/cancel', async ({ request, params }) => ({
    body: await cancelUnpaidBooking(repository, params.reference, request.headers['x-user-id']),
  }));
}

export function createApp({
  router = createRouter(),
  publicDir = DEFAULT_PUBLIC_DIR,
  repository = createMemoryRepository(),
  paymentGateway = mockPaymentGateway,
} = {}) {
  registerApiRoutes(router, repository, paymentGateway);
  const root = resolve(publicDir);

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, 'http://localhost');
      const body = await readJsonBody(request);

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      const match = router.match(request.method, url.pathname);
      if (match !== null) {
        const result = await match.handler({ request, url, params: match.params, body });
        const statusCode = result && Number.isInteger(result.status) ? result.status : 200;
        const responseBody = result && Object.hasOwn(result, 'body') ? result.body : result;
        sendJson(response, statusCode, responseBody ?? null);
        return;
      }

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        throw new DomainError('API route was not found.', 'NOT_FOUND');
      }

      await serveStatic(request, response, url.pathname, root);
    } catch (error) {
      if (!response.headersSent) {
        sendError(response, error);
      } else {
        response.destroy();
      }
    }
  };
}

export function createHttpServer(options) {
  return createServer(createApp(options));
}