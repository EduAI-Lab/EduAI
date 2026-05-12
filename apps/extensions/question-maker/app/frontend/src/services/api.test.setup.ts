/**
 * Installs window/localStorage before importing api.ts (Vitest + node env).
 */
function makeLocation(initialPath: string) {
  const base = 'http://localhost';
  const state = {
    pathname: initialPath,
    href: `${base}${initialPath === '/' ? '' : initialPath}`,
  };
  return new Proxy(state, {
    set(target, prop, value) {
      if (prop === 'href' && typeof value === 'string') {
        const url = value.startsWith('http') ? new URL(value) : new URL(value, base);
        target.href = url.href;
        target.pathname = url.pathname;
        return true;
      }
      return Reflect.set(target, prop, value);
    },
  }) as Location;
}

const storage: Record<string, string> = {};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        for (const k of Object.keys(storage)) delete storage[k];
      },
      key: (i: number) => Object.keys(storage)[i] ?? null,
      get length() {
        return Object.keys(storage).length;
      },
    } as Storage,
    configurable: true,
  });
}

const w = globalThis as typeof globalThis & { window: typeof globalThis; location: Location };
w.window = globalThis;
w.location = makeLocation('/dashboard');
