export function debugLog(...args: any[]): void {
  if (process.env.DEBUG_VERBOSE?.toLowerCase() === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    console.log(...args);
  }
}