let _verbose = false;

export function setVerbose(v: boolean): void {
  _verbose = v;
}

export function isVerbose(): boolean {
  return _verbose;
}

export function verboseLog(...args: unknown[]): void {
  if (_verbose) {
    process.stderr.write(`[verbose] ${args.map(String).join(' ')}\n`);
  }
}
