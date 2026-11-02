import React from 'react';

import { isCapacitorMobileApp } from './mobileNativeChrome';
import { MobileWebBackHistoryController } from './mobileWebBackHistory';

let nextLifecycleGeneration = 0;
let sharedController: MobileWebBackHistoryController | null = null;
let sharedOnBack: () => boolean = () => false;
let sharedPopStateListener: ((event: PopStateEvent) => void) | null = null;

const getSharedController = (): MobileWebBackHistoryController => {
  if (sharedController) return sharedController;

  sharedController = new MobileWebBackHistoryController(
    window.history,
    () => window.location.href,
    () => sharedOnBack(),
  );
  sharedPopStateListener = (event) => sharedController?.handlePopState(event.state);
  window.addEventListener('popstate', sharedPopStateListener);
  return sharedController;
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (sharedPopStateListener) window.removeEventListener('popstate', sharedPopStateListener);
    sharedPopStateListener = null;
    sharedController = null;
    sharedOnBack = () => false;
  });
}

/** Drives the mobile shell's existing Back ladder from browser history. */
export const useMobileWebBackButton = (active: boolean, onBack: () => boolean): void => {
  const activeRef = React.useRef(active);
  const skipNextActiveEffectRef = React.useRef(false);
  activeRef.current = active;

  // A concurrent render may be abandoned. Publish its callback only after
  // commit so the page-level listener always drives the visible shell.
  React.useLayoutEffect(() => {
    if (typeof window === 'undefined' || isCapacitorMobileApp()) return;
    sharedOnBack = onBack;
  }, [onBack]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || isCapacitorMobileApp()) return;

    const lifecycleGeneration = nextLifecycleGeneration += 1;
    const controller = getSharedController();
    // Publish only a committed shell's callback. Concurrent renders that are
    // later abandoned must not replace the listener used by the visible shell.
    skipNextActiveEffectRef.current = true;
    controller.resume(activeRef.current);

    return () => {
      queueMicrotask(() => {
        // Strict Mode and fast reconnects mount a successor before this task.
        if (lifecycleGeneration !== nextLifecycleGeneration) return;
        sharedOnBack = () => false;
        controller.suspend();
      });
    };
  }, []);

  React.useEffect(() => {
    if (skipNextActiveEffectRef.current) {
      skipNextActiveEffectRef.current = false;
      return;
    }
    sharedController?.setActive(active);
  }, [active]);
};
