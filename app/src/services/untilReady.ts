// Keep waiting in `ms` slices until `wait` reports ready or the caller stops.
// A single timeout must not end a long-lived subscription: Teams may learn
// its worker channel minutes after injection (slow start, sleep/wake).
export async function untilReady(wait: (ms: number) => Promise<boolean>, stopped: () => boolean, ms = 30_000) {
  while (!stopped()) {
    if (await wait(ms)) return !stopped();
  }
  return false;
}
