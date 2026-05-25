let _verbose = false;

export function setVerbose(v: boolean): void {
  _verbose = v;
}

export function isVerbose(): boolean {
  return _verbose;
}

export function verboseLog(...args: unknown[]): void {
  if (_verbose) {
    // \r\x1B[2K clears the current spinner line so verbose output
    // doesn't get appended to the spinner text mid-animation.
    process.stdout.write(`\r\x1B[2K[verbose] ${args.map(String).join(' ')}\n`);
  }
}
