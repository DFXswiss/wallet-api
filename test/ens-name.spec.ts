import { HttpException } from '@nestjs/common';
import { requireEnsName } from '../src/ens/ens-name';

describe('ENS names', () => {
  it('accepts a single normal name', () => {
    expect(requireEnsName('Alice.eth')).toBe('Alice.eth');
  });

  it('rejects an empty label', () => {
    for (const name of ['.alice.eth', 'alice.eth.', 'alice..eth']) {
      expect(() => requireEnsName(name)).toThrow(HttpException);
    }
    try {
      requireEnsName('.alice.eth');
      throw new Error('expected EnsNameInvalid');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const rejected = error as HttpException;
      expect(rejected.getStatus()).toBe(400);
      expect(rejected.getResponse()).toMatchObject({ code: 'EnsNameInvalid' });
    }
  });
});
