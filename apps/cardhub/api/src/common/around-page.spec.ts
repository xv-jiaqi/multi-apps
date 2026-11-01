import { aroundPageSkip } from './around-page';

describe('aroundPageSkip', () => {
  it('places the target on the page that contains its index', () => {
    expect(aroundPageSkip(0, 2)).toBe(0);
    expect(aroundPageSkip(1, 2)).toBe(0);
    expect(aroundPageSkip(2, 2)).toBe(2);
    expect(aroundPageSkip(4, 2)).toBe(4);
    expect(aroundPageSkip(5, 20)).toBe(0);
    expect(aroundPageSkip(20, 20)).toBe(20);
  });

  it('treats a bad count or limit as the first page', () => {
    expect(aroundPageSkip(-1, 20)).toBe(0);
    expect(aroundPageSkip(3, 0)).toBe(0);
  });
});
