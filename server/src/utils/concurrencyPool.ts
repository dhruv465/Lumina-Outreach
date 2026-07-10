/**
 * Run `worker` over every item with at most `limit` promises in flight.
 * Resolves when all items are processed. Worker rejections propagate.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  if (items.length === 0) return;

  let nextIndex = 0;
  async function runner(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runner()));
}
