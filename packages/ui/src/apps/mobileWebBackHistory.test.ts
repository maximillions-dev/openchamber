import { describe, expect, test } from 'bun:test';

import {
  MOBILE_WEB_BACK_GUARD_KEY,
  MobileWebBackHistoryController,
  getMobileWebBackGuard,
  type MobileWebHistory,
} from './mobileWebBackHistory';

class FakeHistory implements MobileWebHistory {
  readonly entries: unknown[] = [{}];
  index = 0;
  backCalls = 0;

  get state(): unknown {
    return this.entries[this.index];
  }

  pushState(data: unknown, _unused: string, _url?: string | URL | null): void {
    this.entries.splice(this.index + 1, Infinity, data);
    this.index += 1;
  }

  back(): void {
    this.backCalls += 1;
    if (this.index > 0) this.index -= 1;
  }
}

const browserBack = (history: FakeHistory, controller: MobileWebBackHistoryController): void => {
  history.back();
  controller.handlePopState(history.state);
};

const setup = () => {
  const history = new FakeHistory();
  let handled = 0;
  const controller = new MobileWebBackHistoryController(history, () => 'https://app.test/chat', () => {
    handled += 1;
    return true;
  });
  return { history, controller, handled: () => handled };
};

describe('mobile web Back history', () => {
  test('arms a same-document guard only while a shell layer is open', () => {
    const { history, controller } = setup();
    controller.setActive(false);
    expect(history.entries).toHaveLength(1);

    controller.setActive(true);
    expect(history.entries).toHaveLength(2);
    expect(typeof getMobileWebBackGuard(history.state)).toBe('string');
  });

  test('runs the Back ladder and removes the re-armed guard after the last layer closes', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    browserBack(history, controller);
    expect(handled()).toBe(1);
    expect(typeof getMobileWebBackGuard(history.state)).toBe('string');

    controller.setActive(false);
    controller.handlePopState(history.state);
    expect(getMobileWebBackGuard(history.state)).toBeNull();
  });

  test('leaves nested Settings history to its own popstate handler', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    history.pushState({
      ...(history.state as Record<string, unknown>),
      __openchamberSettingsDetail: { page: 'providers', stage: 'page-content' },
    }, '');

    browserBack(history, controller);
    expect(handled()).toBe(0);
    expect(typeof getMobileWebBackGuard(history.state)).toBe('string');

    browserBack(history, controller);
    expect(handled()).toBe(1);
  });

  test('re-arms the guard when a popup closes but the shell layer stays open', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    browserBack(history, controller);
    expect(handled()).toBe(1);
    expect(typeof getMobileWebBackGuard(history.state)).toBe('string');

    browserBack(history, controller);
    expect(handled()).toBe(2);
  });

  test('programmatic close unwinds copied detail state and the shell guard', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    history.pushState({ ...(history.state as Record<string, unknown>), detail: true }, '');

    controller.setActive(false);
    controller.handlePopState(history.state);
    controller.handlePopState(history.state);
    expect(history.backCalls).toBe(2);
    expect(history.index).toBe(0);
    expect(handled()).toBe(0);
  });

  test('skips an inactive stale guard left below a later route', () => {
    const { history, controller, handled } = setup();
    history.pushState({ [MOBILE_WEB_BACK_GUARD_KEY]: 'old-shell' }, '');
    history.pushState({}, '');

    browserBack(history, controller);
    controller.handlePopState(history.state);
    expect(history.index).toBe(0);
    expect(handled()).toBe(0);
  });

  test('skips its own guard when route navigation was pushed above it', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    history.pushState({}, '');
    controller.setActive(false);

    browserBack(history, controller);
    controller.handlePopState(history.state);
    expect(history.index).toBe(0);
    expect(handled()).toBe(0);
  });

  test('suspended current guard makes the next Back continue past its same-URL base', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    controller.suspend();
    browserBack(history, controller);
    expect(history.index).toBe(0);
    expect(history.backCalls).toBe(2);
    expect(handled()).toBe(0);
  });

  test('suspended buried guard is skipped when Back reaches it', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    history.pushState({}, '');
    controller.suspend();

    browserBack(history, controller);
    controller.handlePopState(history.state);
    expect(history.index).toBe(0);
    expect(history.backCalls).toBe(2);
    expect(handled()).toBe(0);
  });

  test('inactive resume preserves a suspended guard until the next real Back', () => {
    const { history, controller, handled } = setup();
    controller.setActive(true);
    controller.suspend();

    controller.resume(false);
    expect(history.backCalls).toBe(0);
    controller.setActive(true);
    browserBack(history, controller);
    expect(history.backCalls).toBe(1);
    expect(handled()).toBe(1);
    expect(typeof getMobileWebBackGuard(history.state)).toBe('string');
  });
});
