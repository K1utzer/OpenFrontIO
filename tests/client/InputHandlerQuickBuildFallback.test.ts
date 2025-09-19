/**
 * @jest-environment jsdom
 */

import {
  InputHandler,
  MouseUpEvent,
  QuickBuildEvent,
  QuickBuildFailedEvent,
} from "../../src/client/InputHandler";
import { EventBus } from "../../src/core/EventBus";

describe("InputHandler quick build fallback", () => {
  function createPointerEvent(
    overrides: Partial<PointerEvent> & { x: number; y: number },
  ): PointerEvent {
    const base = {
      button: 0,
      clientX: overrides.x,
      clientY: overrides.y,
      x: overrides.x,
      y: overrides.y,
      pointerId: 1,
      pointerType: "mouse",
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault: () => undefined,
    } as PointerEvent;

    return Object.assign(base, overrides);
  }

  it("re-emits a normal mouse up when quick build fails", () => {
    jest.useFakeTimers();

    const canvas = document.createElement("canvas");
    const eventBus = new EventBus();
    const handler = new InputHandler(canvas, eventBus);
    handler.initialize();

    const internal = handler as unknown as {
      activeKeys: Set<string>;
      onPointerDown: (event: PointerEvent) => void;
    };

    const emitSpy = jest.spyOn(eventBus, "emit");

    internal.activeKeys.add("Digit3");

    const pointerDown = createPointerEvent({ x: 100, y: 120 });
    internal.onPointerDown(pointerDown);

    const pointerUp = createPointerEvent({ x: 100, y: 120 });
    handler.onPointerUp(pointerUp);

    const quickBuildCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof QuickBuildEvent,
    );
    expect(quickBuildCall).toBeDefined();

    eventBus.emit(new QuickBuildFailedEvent(pointerUp.x, pointerUp.y));

    const mouseUpCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof MouseUpEvent,
    );
    expect(mouseUpCall).toBeDefined();

    handler.destroy();
    jest.useRealTimers();
  });
});
