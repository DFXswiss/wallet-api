import { createPinnedLookup } from '../src/outbound/pinned-lookup';

describe('pinned lookup', () => {
  it('returns the pinned address without resolving DNS', () => {
    const lookup = createPinnedLookup(['203.0.113.10']);
    const callback = jest.fn();

    lookup('example.com', {}, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.10', 4);
    expect(callback.mock.calls[0][1]).not.toEqual(expect.any(Function));
  });

  it('throws for an empty pin list before connecting', () => {
    expect(() => createPinnedLookup([])).toThrow();
  });
});
