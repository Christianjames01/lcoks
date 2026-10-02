// Inactivity auto-lock timer. The renderer reports user activity (throttled);
// when no activity is seen for the configured period, `onLock` fires.

export class AutoLockTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private minutes = 0;

  constructor(private readonly onLock: () => void) {}

  configure(minutes: number): void {
    this.minutes = minutes;
    this.reset();
  }

  /** Call on any user activity while unlocked. */
  reset(): void {
    this.stop();
    if (this.minutes > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.onLock();
      }, this.minutes * 60_000);
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get active(): boolean {
    return this.timer !== null;
  }
}
