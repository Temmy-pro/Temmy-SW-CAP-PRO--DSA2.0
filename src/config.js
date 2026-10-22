export function getPort(environment = process.env) {
  const value = environment.PORT ?? '3000';
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError('PORT must be an integer between 1 and 65535.');
  }

  return port;
}

export const PORT = getPort();