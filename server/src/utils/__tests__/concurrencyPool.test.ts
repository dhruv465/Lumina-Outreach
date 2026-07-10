import { runWithConcurrency } from '../concurrencyPool';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runWithConcurrency', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n); });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runWithConcurrency([...Array(10).keys()], 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('resolves immediately for an empty list', async () => {
    await expect(runWithConcurrency([], 2, async () => {})).resolves.toBeUndefined();
  });
});
