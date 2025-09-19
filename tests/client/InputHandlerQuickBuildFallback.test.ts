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
      onPointerMove: (event: PointerEvent) => void;
    };

    const emitSpy = jest.spyOn(eventBus, "emit");

    const pointerMove = createPointerEvent({ x: 100, y: 120 });
    internal.onPointerMove(pointerMove);

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3" }));

    const quickBuildCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof QuickBuildEvent,
    );
    expect(quickBuildCall).toBeDefined();

    eventBus.emit(new QuickBuildFailedEvent(pointerMove.x, pointerMove.y));

    const mouseUpCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof MouseUpEvent,
    );
    expect(mouseUpCall).toBeDefined();

    handler.destroy();
    jest.useRealTimers();
  });

  it("emits quick build events for missile hotkeys", () => {
    jest.useFakeTimers();

    const canvas = document.createElement("canvas");
    const eventBus = new EventBus();
    const handler = new InputHandler(canvas, eventBus);
    handler.initialize();

    const internal = handler as unknown as {
      onPointerMove: (event: PointerEvent) => void;
    };

    const pointerMove = createPointerEvent({ x: 80, y: 90 });
    internal.onPointerMove(pointerMove);

    const emitSpy = jest.spyOn(eventBus, "emit");

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ" }));

    const quickBuildCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof QuickBuildEvent,
    );
    expect(quickBuildCall).toBeDefined();

    handler.destroy();
    jest.useRealTimers();
  });

});
