import { execFile } from 'child_process';
import { promisify } from 'util';
import { execFileNoThrow } from '../../src/utils/execFileNoThrow';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));
jest.mock('util', () => ({
  promisify: jest.fn((fn: unknown) => fn),
}));

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('execFileNoThrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns stdout, stderr and exitCode 0 on success', async () => {
    (mockExecFile as unknown as jest.Mock).mockResolvedValueOnce({
      stdout: 'hello world\n',
      stderr: '',
    });
    const result = await execFileNoThrow('echo', ['hello world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world\n');
    expect(result.stderr).toBe('');
  });

  it('returns exitCode and stderr when the command fails with stdout/stderr/code', async () => {
    const err = Object.assign(new Error('exit code 1'), {
      stdout: '',
      stderr: 'command not found\n',
      code: 127,
    });
    (mockExecFile as unknown as jest.Mock).mockRejectedValueOnce(err);

    const result = await execFileNoThrow('nonexistent', []);
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe('command not found\n');
    expect(result.stdout).toBe('');
  });

  it('falls back to empty strings and exitCode 1 when error has no stdout/stderr/code', async () => {
    // Exercises the `?? ''` and `?? 1` branches
    const bareError = new Error('spawn ENOENT');
    // No stdout, stderr, or code properties
    (mockExecFile as unknown as jest.Mock).mockRejectedValueOnce(bareError);

    const result = await execFileNoThrow('__totally_absent__', []);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('defaults args to empty array when not provided', async () => {
    (mockExecFile as unknown as jest.Mock).mockResolvedValueOnce({ stdout: '', stderr: '' });
    const result = await execFileNoThrow('true');
    expect(result.exitCode).toBe(0);
    expect(mockExecFile).toHaveBeenCalledWith('true', []);
  });
});
