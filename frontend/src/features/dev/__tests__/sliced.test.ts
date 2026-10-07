import { describe, expect, it, vi } from 'vitest';
import { runSliced } from '../api';
import type { Progress } from '../types';

const slice = (done: number, next: number | null, failed: Progress['failed'] = [], conflicts: Progress['conflicts'] = []): Progress =>
  ({ total: 7, done, next_offset: next, failed, conflicts });

describe('runSliced (plan push, directory rebuild)', () => {
  it('walks every slice from 0 until the server says it is done, reporting progress each time', async () => {
    const offsets: number[] = [];
    const steps = [slice(3, 3), slice(6, 6), slice(7, null)];
    const seen: number[] = [];
    const final = await runSliced(async (o) => { offsets.push(o); return steps[offsets.length - 1]; }, (p) => seen.push(p.done));
    expect(offsets).toEqual([0, 3, 6]);
    expect(seen).toEqual([3, 6, 7]);
    expect(final.next_offset).toBeNull();
  });

  it('collects failures and conflicts from every slice instead of stopping at the first', async () => {
    const steps = [
      slice(2, 2, [{ code: 'a', error: 'boom' }]),
      slice(4, null, [{ code: 'b', error: 'bang' }], [{ shop: 'c', error: 'taken' }]),
    ];
    let i = 0;
    const final = await runSliced(async () => steps[i++], () => undefined);
    expect(final.failed.map((f) => f.code)).toEqual(['a', 'b']);
    expect(final.conflicts).toEqual([{ shop: 'c', error: 'taken' }]);
  });

  it('stops and surfaces the error when a slice fails outright', async () => {
    const progress = vi.fn();
    await expect(runSliced(async () => { throw new Error('server down'); }, progress)).rejects.toThrow('server down');
    expect(progress).not.toHaveBeenCalled();
  });
});
