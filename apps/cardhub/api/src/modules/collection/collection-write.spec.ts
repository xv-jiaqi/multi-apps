import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { retryUniqueConflict } from './collection-write';

function uniqueConflict(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('retryUniqueConflict', () => {
  it('retries once after P2002 and returns the second write', async () => {
    const write = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(uniqueConflict())
      .mockResolvedValueOnce('saved');
    await expect(retryUniqueConflict(write)).resolves.toBe('saved');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('does not retry a different error', async () => {
    const write = jest.fn<Promise<string>, []>().mockRejectedValueOnce(new Error('down'));
    await expect(retryUniqueConflict(write)).rejects.toThrow('down');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
