export const MOBILE_WEB_BACK_GUARD_KEY = '__openchamberMobileBackGuard';

type HistoryState = Record<string, unknown>;

export type MobileWebHistory = {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
  back(): void;
};

let nextGuardId = 0;

const objectHistoryState = (state: unknown): HistoryState => (
  typeof state === 'object' && state !== null && !Array.isArray(state)
    ? state as HistoryState
    : {}
);

export const getMobileWebBackGuard = (state: unknown): string | null => {
  const guard = objectHistoryState(state)[MOBILE_WEB_BACK_GUARD_KEY];
  return typeof guard === 'string' ? guard : null;
};

/**
 * Keeps one same-URL history entry above the page while the mobile web shell
 * has something that Back should dismiss. A consumed Back re-arms the entry;
 * the following React render removes it when the last layer has closed.
 */
export class MobileWebBackHistoryController {
  private active = false;
  private cleaning = false;
  private suspendedFromGuard = false;
  private readonly guardId = `mobile-shell-${nextGuardId += 1}`;
  private readonly history: MobileWebHistory;
  private readonly currentUrl: () => string;
  private readonly onBack: () => boolean;

  constructor(
    history: MobileWebHistory,
    currentUrl: () => string,
    onBack: () => boolean,
  ) {
    this.history = history;
    this.currentUrl = currentUrl;
    this.onBack = onBack;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.suspendedFromGuard = false;
    const currentGuard = getMobileWebBackGuard(this.history.state);

    if (active) {
      if (currentGuard !== this.guardId) this.pushGuard();
      return;
    }

    // A nested Settings detail can copy the guard state. Walk through every
    // copied entry as well as the guard itself, one popstate at a time.
    if (currentGuard !== null) this.continueCleanup();
  }

  /** Reattaches a shell without traversing a guard retained during unmount. */
  resume(active: boolean): void {
    if (!active && this.suspendedFromGuard) {
      this.active = false;
      return;
    }
    this.setActive(active);
  }

  /** Keeps stale guards skippable without starting a traversal during unmount. */
  suspend(): void {
    this.active = false;
    this.cleaning = false;
    this.suspendedFromGuard = this.ownsGuard(this.history.state);
  }

  ownsGuard(state: unknown): boolean {
    return getMobileWebBackGuard(state) === this.guardId;
  }

  handlePopState(state: unknown): void {
    const targetGuard = getMobileWebBackGuard(state);

    // Settings detail entries copy the shell guard. Moving between those and
    // the real guard belongs to Settings, unless the whole shell is closing.
    if (targetGuard === this.guardId) {
      if (!this.active) {
        this.suspendedFromGuard = false;
        if (this.cleaning) this.history.back();
        else this.continueCleanup();
      }
      return;
    }

    this.cleaning = false;
    if (!this.active) {
      // If the shell unmounted while its guard was current, one Back lands on
      // the same-URL base entry. Continue once so that press is not a no-op.
      if (this.suspendedFromGuard) {
        this.suspendedFromGuard = false;
        this.history.back();
        return;
      }
      // Route changes can leave an old guard below the current URL. Do not add
      // a ghost Back step when that stale entry is reached later.
      if (targetGuard !== null) this.continueCleanup();
      return;
    }

    if (!this.onBack()) return;
    // Re-arm immediately. If the callback closed the final layer, setActive
    // removes this entry after React commits that state update.
    this.pushGuard();
  }

  private pushGuard(): void {
    this.cleaning = false;
    this.history.pushState(
      {
        ...objectHistoryState(this.history.state),
        [MOBILE_WEB_BACK_GUARD_KEY]: this.guardId,
      },
      '',
      this.currentUrl(),
    );
  }

  private continueCleanup(): void {
    if (this.cleaning) return;
    this.cleaning = true;
    this.history.back();
  }
}
