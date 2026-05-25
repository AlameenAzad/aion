import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs an executable with the given arguments, returning stdout/stderr/exitCode
 * without throwing. Uses execFile (not exec) to prevent shell injection.
 */
export async function execFileNoThrow(
  file: string,
  args: string[] = []
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args);
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
    };
  }
}
