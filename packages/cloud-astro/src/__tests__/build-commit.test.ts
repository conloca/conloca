import { describe, expect, it } from 'bun:test';
import { registrationCommits } from '../build-commit.js';

describe('registrationCommits', () => {
  it("registers the branch's handed-over latest commit and records the checkout as the built commit", () => {
    expect(registrationCommits({ eventCommitSha: 'head', checkoutCommitSha: 'merge' })).toEqual({
      gitSha: 'head',
      buildId: 'merge',
    });
  });

  it('uses the checkout for both when nothing was handed over', () => {
    expect(registrationCommits({ eventCommitSha: undefined, checkoutCommitSha: 'local' })).toEqual({
      gitSha: 'local',
      buildId: 'local',
    });
  });

  it('uses the handed-over commit for both outside a git checkout', () => {
    expect(registrationCommits({ eventCommitSha: 'head', checkoutCommitSha: undefined })).toEqual({
      gitSha: 'head',
      buildId: 'head',
    });
  });

  it('resolves nothing without either source', () => {
    expect(registrationCommits({ eventCommitSha: undefined, checkoutCommitSha: undefined })).toEqual({
      gitSha: undefined,
      buildId: undefined,
    });
  });
});
