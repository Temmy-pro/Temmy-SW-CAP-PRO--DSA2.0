import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PORT } from './config.js';
import { createApp } from './http/app.js';

export function startServer(port = PORT) {
  const server = createServer(createApp());
  server.listen(port);
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = startServer();
  server.on('listening', () => {
    console.log(`Event ticketing server listening on port ${server.address().port}.`);
  });
}