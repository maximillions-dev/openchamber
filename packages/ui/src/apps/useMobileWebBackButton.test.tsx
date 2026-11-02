import { expect, spyOn, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';

import { getMobileWebBackGuard } from './mobileWebBackHistory';
import { useMobileWebBackButton } from './useMobileWebBackButton';

test('Strict Mode keeps one guard and inactive remount does not start a traversal', async () => {
  const dom = new Window({ url: 'https://app.test/chat' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    PopStateEvent: dom.PopStateEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  const entries: unknown[] = [window.history.state];
  let index = 0;
  let backCalls = 0;
  let handled = 0;
  let abandonedHandled = 0;
  const push = window.history.pushState.bind(window.history);
  const replace = window.history.replaceState.bind(window.history);
  const pushSpy = spyOn(window.history, 'pushState').mockImplementation((state, unused, url) => {
    push(state, unused, url);
    entries.splice(index + 1, Infinity, state);
    index += 1;
  });
  const backSpy = spyOn(window.history, 'back').mockImplementation(() => {
    backCalls += 1;
    if (index > 0) index -= 1;
    replace(entries[index], '', window.location.href);
  });
  const never = new Promise<void>(() => undefined);
  const Harness: React.FC<{ active: boolean; abandoned?: boolean; suspend?: boolean }> = ({ active, abandoned = false, suspend = false }) => {
    useMobileWebBackButton(active, () => {
      if (abandoned) abandonedHandled += 1;
      else handled += 1;
      return true;
    });
    if (suspend) throw never;
    return null;
  };
  const root = createRoot(document.createElement('div'));
  let successorRoot: ReturnType<typeof createRoot> | null = null;

  try {
    await act(async () => {
      root.render(<React.StrictMode><Harness active /></React.StrictMode>);
    });
    expect(entries).toHaveLength(2);
    expect(typeof getMobileWebBackGuard(window.history.state)).toBe('string');

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect(backCalls).toBe(0);

    successorRoot = createRoot(document.createElement('div'));
    await act(async () => {
      successorRoot?.render(
        <React.Suspense fallback={null}><Harness active={false} /></React.Suspense>,
      );
    });
    expect(backCalls).toBe(0);

    await act(async () => {
      successorRoot?.render(
        <React.Suspense fallback={null}><Harness active /></React.Suspense>,
      );
    });
    expect(backCalls).toBe(0);

    await act(async () => {
      React.startTransition(() => {
        successorRoot?.render(
          <React.Suspense fallback={null}>
            <Harness active abandoned suspend />
          </React.Suspense>,
        );
      });
      await Promise.resolve();
    });

    await act(async () => {
      window.history.back();
      window.dispatchEvent(new window.PopStateEvent('popstate', { state: window.history.state }));
    });
    expect(backCalls).toBe(1);
    expect(handled).toBe(1);
    expect(abandonedHandled).toBe(0);
  } finally {
    if (successorRoot) {
      await act(async () => successorRoot?.unmount());
    }
    pushSpy.mockRestore();
    backSpy.mockRestore();
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
