import { requestIdSchema, resolveRequestId } from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request id', () => {
  it('accepts a trimmed upstream id', () => {
    expect(requestIdSchema.parse('  req_1.2:abc-DEF  ')).toBe('req_1.2:abc-DEF');
    expect(resolveRequestId('edge-42')).toBe('edge-42');
    expect(resolveRequestId(['first-id', 'second-id'])).toBe('first-id');
  });

  it.each([
    undefined,
    '',
    '   ',
    'has space',
    'bad\r\nX-Injected: 1',
    'bad\nid',
    '.dot',
    '-flag',
    'a'.repeat(129),
    'id,other',
  ])('replaces an unusable header (%j) with a uuid', (header) => {
    const id = resolveRequestId(header);
    expect(id).toMatch(UUID);
    if (typeof header === 'string' && header.length > 0) {
      expect(id).not.toContain(header);
    }
  });
});
