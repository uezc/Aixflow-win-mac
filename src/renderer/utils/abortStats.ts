let abortCount = 0;

export function recordAbortEvent(count = 1): void {
  abortCount += Math.max(0, Math.floor(count));
}

export function consumeAbortCount(): number {
  const current = abortCount;
  abortCount = 0;
  return current;
}

