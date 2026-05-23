import { setVerbose, isVerbose, verboseLog } from '../../src/utils/verbose';

afterEach(() => {
  setVerbose(false);
});

describe('verbose utility', () => {
  it('isVerbose returns false by default', () => {
    expect(isVerbose()).toBe(false);
  });

  it('setVerbose(true) makes isVerbose return true', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  it('setVerbose(false) makes isVerbose return false after being set to true', () => {
    setVerbose(true);
    setVerbose(false);
    expect(isVerbose()).toBe(false);
  });

  it('verboseLog writes nothing to stderr when verbose is false', () => {
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setVerbose(false);
    verboseLog('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('verboseLog writes to stderr when verbose is true', () => {
    const written: string[] = [];
    const spy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk) => { written.push(String(chunk)); return true; });
    setVerbose(true);
    verboseLog('hello', 'world');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(written[0]).toContain('[verbose]');
    expect(written[0]).toContain('hello');
    expect(written[0]).toContain('world');
    spy.mockRestore();
  });

  it('verboseLog writes multiple args joined by space', () => {
    const written: string[] = [];
    const spy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk) => { written.push(String(chunk)); return true; });
    setVerbose(true);
    verboseLog('a', 42, true);
    expect(written[0]).toContain('a 42 true');
    spy.mockRestore();
  });
});
