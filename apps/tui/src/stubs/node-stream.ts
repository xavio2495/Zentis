/**
 * Enough of a Node stream to satisfy Ink in a browser.
 *
 * Ink reaches for the whole `EventEmitter` surface and a little of `Stream`'s, across several code
 * paths that a browser exercises in a different order from a terminal. Shimming these one method at
 * a time as each throws costs a rebuild per method and stops at the first path that happens to be
 * taken, so the whole surface is provided at once and the ones that mean nothing here do nothing.
 */
export interface EmitterSurface {
  on(event: string, handler: Handler): unknown;
  off(event: string, handler: Handler): unknown;
  once(event: string, handler: Handler): unknown;
  addListener(event: string, handler: Handler): unknown;
  removeListener(event: string, handler: Handler): unknown;
  removeAllListeners(event?: string): unknown;
  listenerCount(event: string): number;
  listeners(event: string): Handler[];
  setMaxListeners(): unknown;
  emit(event: string, ...args: unknown[]): boolean;
  ref(): unknown;
  unref(): unknown;
}

type Handler = (...args: unknown[]) => void;

export function emitter(): EmitterSurface & { fire(event: string, ...args: unknown[]): void } {
  const listeners = new Map<string, Set<Handler>>();
  const self = {} as EmitterSurface & { fire(event: string, ...args: unknown[]): void };

  const add = (event: string, handler: Handler) => {
    const set = listeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    listeners.set(event, set);
    return self;
  };
  const remove = (event: string, handler: Handler) => {
    listeners.get(event)?.delete(handler);
    return self;
  };
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
  };

  Object.assign(self, {
    on: add,
    addListener: add,
    // `once` is registered as an ordinary listener: nothing here fires an event whose second
    // delivery would matter, and a self-removing wrapper would only add a way to get that wrong.
    once: add,
    off: remove,
    removeListener: remove,
    removeAllListeners: (event?: string) => {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
      return self;
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    listeners: (event: string) => [...(listeners.get(event) ?? [])],
    setMaxListeners: () => self,
    emit: (event: string, ...args: unknown[]) => {
      fire(event, ...args);
      return true;
    },
    ref: () => self,
    unref: () => self,
    fire,
  });

  return self;
}
