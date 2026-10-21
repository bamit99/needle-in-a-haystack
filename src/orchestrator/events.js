export function createEventBus() {
  const subs = new Set();
  return {
    on: (cb) => subs.add(cb),
    off: (cb) => subs.delete(cb),
    emit: (event) => { for (const cb of subs) cb(event); },
  };
}
