import { DomainError } from '../domain/errors.js';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new DomainError('Route paths must start with a slash.', 'VALIDATION');
  }

  const names = [];
  const segments = path.split('/').slice(1).map((segment) => {
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        throw new DomainError('Route parameter names must be valid identifiers.', 'VALIDATION');
      }
      names.push(name);
      return '([^/]+)';
    }

    return escapeRegex(segment);
  });

  return { names, pattern: new RegExp(`^/${segments.join('/')}/?$`) };
}

export class Router {
  #routes = [];

  add(method, path, handler) {
    if (typeof method !== 'string' || method.trim() === '') {
      throw new DomainError('Route method must be a non-empty string.', 'VALIDATION');
    }

    if (typeof handler !== 'function') {
      throw new DomainError('Route handler must be a function.', 'VALIDATION');
    }

    const normalizedMethod = method.toUpperCase();
    const { names, pattern } = compilePath(path);

    if (this.#routes.some((route) => route.method === normalizedMethod && route.path === path)) {
      throw new DomainError(`Route already exists: ${normalizedMethod} ${path}.`, 'VALIDATION');
    }

    this.#routes.push({ method: normalizedMethod, path, names, pattern, handler });
    return this;
  }

  match(method, pathname) {
    if (typeof method !== 'string' || typeof pathname !== 'string') {
      return null;
    }

    const normalizedMethod = method.toUpperCase();

    for (const route of this.#routes) {
      if (route.method !== normalizedMethod) {
        continue;
      }

      const match = route.pattern.exec(pathname);
      if (match === null) {
        continue;
      }

      try {
        const params = Object.fromEntries(route.names.map((name, index) => [
          name,
          decodeURIComponent(match[index + 1]),
        ]));
        return { handler: route.handler, params };
      } catch {
        return null;
      }
    }

    return null;
  }
}

export function createRouter() {
  return new Router();
}