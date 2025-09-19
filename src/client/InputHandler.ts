import { EventBus, GameEvent } from "../core/EventBus";
import { UnitType } from "../core/game/Game";
import { UnitView } from "../core/game/GameView";
import { UserSettings } from "../core/game/UserSettings";
import { ReplaySpeedMultiplier } from "./utilities/ReplaySpeedMultiplier";

export class MouseUpEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseOverEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

/**
 * Event emitted when a unit is selected or deselected
 */
export class UnitSelectionEvent implements GameEvent {
  constructor(
    public readonly unit: UnitView | null,
    public readonly isSelected: boolean,
  ) {}
}

export class MouseDownEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class MouseMoveEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ContextMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ZoomEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly delta: number,
  ) {}
}

export class DragEvent implements GameEvent {
  constructor(
    public readonly deltaX: number,
    public readonly deltaY: number,
  ) {}
}

export class AlternateViewEvent implements GameEvent {
  constructor(public readonly alternateView: boolean) {}
}

export class CloseViewEvent implements GameEvent {}

export class RefreshGraphicsEvent implements GameEvent {}

export class TogglePerformanceOverlayEvent implements GameEvent {}

export class ToggleStructureEvent implements GameEvent {
  constructor(public readonly structureType: UnitType | null) {}
}

export class QuickBuildEvent implements GameEvent {
  constructor(
    public readonly unitType: UnitType,
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class QuickBuildFailedEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class ShowBuildMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}
export class ShowEmojiMenuEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class DoBoatAttackEvent implements GameEvent {}

export class DoGroundAttackEvent implements GameEvent {}

export class AttackRatioEvent implements GameEvent {
  constructor(public readonly attackRatio: number) {}
}

export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class CenterCameraEvent implements GameEvent {
  constructor() {}
}

export class AutoUpgradeEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {}
}

export class InputHandler {
  private lastPointerX: number = 0;
  private lastPointerY: number = 0;
  private pointerPositionKnown = false;

  private lastPointerDownX: number = 0;
  private lastPointerDownY: number = 0;

  private pointers: Map<number, PointerEvent> = new Map();

  private lastPinchDistance: number = 0;

  private pointerDown: boolean = false;

  private alternateView = false;

  private moveInterval: NodeJS.Timeout | null = null;
  private activeKeys = new Set<string>();
  private keybinds: Record<string, string> = {};
  private readonly quickBuildHotkeys = new Map<string, UnitType>([
    ["Digit3", UnitType.Port],
    ["Digit4", UnitType.City],
    ["Digit5", UnitType.Factory],
    ["Digit6", UnitType.DefensePost],
    ["Digit7", UnitType.SAMLauncher],
    ["Digit8", UnitType.MissileSilo],
    ["Digit9", UnitType.Warship],
    ["Digit0", UnitType.AtomBomb],
    ["KeyH", UnitType.HydrogenBomb],
    ["KeyM", UnitType.MIRV],
    ["KeyJ", UnitType.ClusterRocket],
    ["KeyK", UnitType.TacticalRocket],
    ["KeyL", UnitType.MissileShip],
  ]);

  private pendingQuickBuild: UnitType | null = null;
  private lastQuickBuildAttempt: { x: number; y: number } | null = null;
  private readonly handleQuickBuildFailure = (event: QuickBuildFailedEvent) => {
    if (this.lastQuickBuildAttempt === null) {
      return;
    }

    this.eventBus.emit(new MouseUpEvent(event.x, event.y));
    this.lastQuickBuildAttempt = null;
  };

  private readonly PAN_SPEED = 5;
  private readonly ZOOM_SPEED = 10;

  private userSettings: UserSettings = new UserSettings();

  constructor(
    private canvas: HTMLCanvasElement,
    private eventBus: EventBus,
  ) {}

  initialize() {
    this.keybinds = {
      toggleView: "Space",
      centerCamera: "KeyC",
      moveUp: "KeyW",
      moveDown: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      zoomOut: "KeyQ",
      zoomIn: "KeyE",
      attackRatioDown: "Digit1",
      attackRatioUp: "Digit2",
      boatAttack: "KeyB",
      groundAttack: "KeyG",
      modifierKey: "ControlLeft",
      altKey: "AltLeft",
      ...JSON.parse(localStorage.getItem("settings.keybinds") ?? "{}"),
    };

    // Mac users might have different keybinds
    const isMac = /Mac/.test(navigator.userAgent);
    if (isMac) {
      this.keybinds.modifierKey = "MetaLeft"; // Use Command key on Mac
    }

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.onTrackpadPan(e)) {
          this.onScroll(e);
        }
        this.onShiftScroll(e);
        e.preventDefault();
      },
      { passive: false },
    );
    window.addEventListener("pointermove", this.onPointerMove.bind(this));
    this.canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    window.addEventListener("mousemove", (e) => {
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.pointerPositionKnown = true;
      if (e.movementX || e.movementY) {
        this.eventBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
      }
    });

    this.canvas.addEventListener("touchstart", (e) => this.onTouchStart(e), {
      passive: false,
    });
    this.canvas.addEventListener("touchmove", (e) => this.onTouchMove(e), {
      passive: false,
    });
    this.canvas.addEventListener("touchend", (e) => this.onTouchEnd(e), {
      passive: false,
    });
    this.pointers.clear();

    this.moveInterval = setInterval(() => {
      let deltaX = 0;
      let deltaY = 0;

      // Skip if shift is held down
      if (
        this.activeKeys.has("ShiftLeft") ||
        this.activeKeys.has("ShiftRight")
      ) {
        return;
      }

      if (
        this.activeKeys.has(this.keybinds.moveUp) ||
        this.activeKeys.has("ArrowUp")
      )
        deltaY += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveDown) ||
        this.activeKeys.has("ArrowDown")
      )
        deltaY -= this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveLeft) ||
        this.activeKeys.has("ArrowLeft")
      )
        deltaX += this.PAN_SPEED;
      if (
        this.activeKeys.has(this.keybinds.moveRight) ||
        this.activeKeys.has("ArrowRight")
      )
        deltaX -= this.PAN_SPEED;

      if (deltaX || deltaY) {
        this.eventBus.emit(new DragEvent(deltaX, deltaY));
      }

      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;

      if (
        this.activeKeys.has(this.keybinds.zoomOut) ||
        this.activeKeys.has("Minus")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, this.ZOOM_SPEED));
      }
      if (
        this.activeKeys.has(this.keybinds.zoomIn) ||
        this.activeKeys.has("Equal")
      ) {
        this.eventBus.emit(new ZoomEvent(cx, cy, -this.ZOOM_SPEED));
      }
    }, 1);

    window.addEventListener("keydown", (e) => {
      if (e.code === this.keybinds.toggleView) {
        e.preventDefault();
        if (!this.alternateView) {
          this.alternateView = true;
          this.eventBus.emit(new AlternateViewEvent(true));
        }
      }

      if (e.code === "Escape") {
        e.preventDefault();
        this.eventBus.emit(new CloseViewEvent());
      }

      if (
        [
          this.keybinds.moveUp,
          this.keybinds.moveDown,
          this.keybinds.moveLeft,
          this.keybinds.moveRight,
          this.keybinds.zoomOut,
          this.keybinds.zoomIn,
          "ArrowUp",
          "ArrowLeft",
          "ArrowDown",
          "ArrowRight",
          "Minus",
          "Equal",
          this.keybinds.attackRatioDown,
          this.keybinds.attackRatioUp,
          this.keybinds.centerCamera,
          "ControlLeft",
          "ControlRight",
          "ShiftLeft",
          "ShiftRight",
        ].includes(e.code) ||
        this.quickBuildHotkeys.has(e.code)
      ) {
        this.activeKeys.add(e.code);
      }

      if (this.quickBuildHotkeys.has(e.code)) {
        e.preventDefault();
        if (!e.repeat && this.pointerPositionKnown) {
          const quickBuildType = this.quickBuildHotkeys.get(e.code)!;
          this.triggerQuickBuild(
            quickBuildType,
            this.lastPointerX,
            this.lastPointerY,
          );
          this.activeKeys.delete(e.code);
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === this.keybinds.toggleView) {
        e.preventDefault();
        this.alternateView = false;
        this.eventBus.emit(new AlternateViewEvent(false));
      }

      if (e.key.toLowerCase() === "r" && e.altKey && !e.ctrlKey) {
        e.preventDefault();
        this.eventBus.emit(new RefreshGraphicsEvent());
      }

      if (e.code === this.keybinds.boatAttack) {
        e.preventDefault();
        this.eventBus.emit(new DoBoatAttackEvent());
      }

      if (e.code === this.keybinds.groundAttack) {
        e.preventDefault();
        this.eventBus.emit(new DoGroundAttackEvent());
      }

      if (e.code === this.keybinds.attackRatioDown) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(-10));
      }

      if (e.code === this.keybinds.attackRatioUp) {
        e.preventDefault();
        this.eventBus.emit(new AttackRatioEvent(10));
      }

      if (e.code === this.keybinds.centerCamera) {
        e.preventDefault();
        this.eventBus.emit(new CenterCameraEvent());
      }

      // Shift-D to toggle performance overlay
      console.log(e.code, e.shiftKey, e.ctrlKey, e.altKey, e.metaKey);
      if (e.code === "KeyD" && e.shiftKey) {
        e.preventDefault();
        console.log("TogglePerformanceOverlayEvent");
        this.eventBus.emit(new TogglePerformanceOverlayEvent());
      }

      this.activeKeys.delete(e.code);
    });

    this.eventBus.on(QuickBuildFailedEvent, this.handleQuickBuildFailure);
  }

  private onPointerDown(event: PointerEvent) {
    this.lastQuickBuildAttempt = null;

    if (event.button === 1) {
      event.preventDefault();
      this.eventBus.emit(new AutoUpgradeEvent(event.clientX, event.clientY));
      return;
    }

    if (event.button > 0) {
      return;
    }

    this.pendingQuickBuild =
      event.pointerType === "touch" ? null : this.getActiveQuickBuildUnitType();

    this.pointerDown = true;
    this.pointers.set(event.pointerId, event);

    if (this.pointers.size === 1) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.pointerPositionKnown = true;

      this.lastPointerDownX = event.clientX;
      this.lastPointerDownY = event.clientY;

      this.eventBus.emit(new MouseDownEvent(event.clientX, event.clientY));
    } else if (this.pointers.size === 2) {
      this.lastPinchDistance = this.getPinchDistance();
    }
  }

  onPointerUp(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      return;
    }

    if (event.button > 0) {
      return;
    }

    const quickBuildCandidate =
      event.pointerType === "touch" ? null : this.pendingQuickBuild;
    this.pendingQuickBuild = null;
    this.pointerDown = false;
    this.pointers.clear();

    this.pointerPositionKnown = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    if (this.isModifierKeyPressed(event)) {
      this.eventBus.emit(new ShowBuildMenuEvent(event.clientX, event.clientY));
      return;
    }
    if (this.isAltKeyPressed(event)) {
      this.eventBus.emit(new ShowEmojiMenuEvent(event.clientX, event.clientY));
      return;
    }

    const dist =
      Math.abs(event.x - this.lastPointerDownX) +
      Math.abs(event.y - this.lastPointerDownY);
    if (dist < 10) {
      if (event.pointerType !== "touch") {
        const quickBuildType =
          quickBuildCandidate ?? this.getActiveQuickBuildUnitType();
        if (quickBuildType !== null) {
          this.triggerQuickBuild(quickBuildType, event.clientX, event.clientY);
          return;
        }
      }

      if (event.pointerType === "touch") {
        this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
        event.preventDefault();
        return;
      }

      if (!this.userSettings.leftClickOpensMenu() || event.shiftKey) {
        this.eventBus.emit(new MouseUpEvent(event.x, event.y));
      } else {
        this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
      }
    }
  }

  private onScroll(event: WheelEvent) {
    if (!event.shiftKey) {
      const realCtrl =
        this.activeKeys.has("ControlLeft") ||
        this.activeKeys.has("ControlRight");
      const ratio = event.ctrlKey && !realCtrl ? 10 : 1; // Compensate pinch-zoom low sensitivity
      this.eventBus.emit(new ZoomEvent(event.x, event.y, event.deltaY * ratio));
    }
  }

  private onShiftScroll(event: WheelEvent) {
    if (event.shiftKey) {
      const scrollValue = event.deltaY === 0 ? event.deltaX : event.deltaY;
      const ratio = scrollValue > 0 ? -10 : 10;
      this.eventBus.emit(new AttackRatioEvent(ratio));
    }
  }

  private onTrackpadPan(event: WheelEvent): boolean {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    const isTrackpadPan = event.deltaMode === 0 && event.deltaX !== 0;

    if (!isTrackpadPan) {
      return false;
    }

    const panSensitivity = 1.0;
    const deltaX = -event.deltaX * panSensitivity;
    const deltaY = -event.deltaY * panSensitivity;

    if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
      this.eventBus.emit(new DragEvent(deltaX, deltaY));
    }
    return true;
  }

  private onPointerMove(event: PointerEvent) {
    if (event.button === 1) {
      event.preventDefault();
      return;
    }

    if (event.button > 0) {
      return;
    }

    this.pointers.set(event.pointerId, event);

    if (!this.pointerDown) {
      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.pointerPositionKnown = true;
      this.eventBus.emit(new MouseOverEvent(event.clientX, event.clientY));
      return;
    }

    if (this.pointers.size === 1) {
      const deltaX = event.clientX - this.lastPointerX;
      const deltaY = event.clientY - this.lastPointerY;

      this.eventBus.emit(new DragEvent(deltaX, deltaY));

      this.lastPointerX = event.clientX;
      this.lastPointerY = event.clientY;
      this.pointerPositionKnown = true;
    } else if (this.pointers.size === 2) {
      const currentPinchDistance = this.getPinchDistance();
      const pinchDelta = currentPinchDistance - this.lastPinchDistance;

      if (Math.abs(pinchDelta) > 1) {
        const zoomCenter = this.getPinchCenter();
        this.eventBus.emit(
          new ZoomEvent(zoomCenter.x, zoomCenter.y, -pinchDelta * 2),
        );
        this.lastPinchDistance = currentPinchDistance;
      }
    }
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault();
    this.eventBus.emit(new ContextMenuEvent(event.clientX, event.clientY));
  }

  private onTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) {
      event.preventDefault();
      // Solve screen jittering problem
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      this.lastPointerX = (touch1.clientX + touch2.clientX) / 2;
      this.lastPointerY = (touch1.clientY + touch2.clientY) / 2;
    }
  }

  private onTouchMove(event: TouchEvent) {
    if (event.touches.length === 2) {
      event.preventDefault();

      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;

      if (this.lastPointerX !== 0 && this.lastPointerY !== 0) {
        const deltaX = centerX - this.lastPointerX;
        const deltaY = centerY - this.lastPointerY;

        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
          this.eventBus.emit(new DragEvent(deltaX, deltaY));
        }
      }

      this.lastPointerX = centerX;
      this.lastPointerY = centerY;
    }
  }

  private onTouchEnd(event: TouchEvent) {
    if (event.touches.length < 2) {
      this.lastPointerX = 0;
      this.lastPointerY = 0;
    }
  }

  private getPinchDistance(): number {
    const pointerEvents = Array.from(this.pointers.values());
    const dx = pointerEvents[0].clientX - pointerEvents[1].clientX;
    const dy = pointerEvents[0].clientY - pointerEvents[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private getPinchCenter(): { x: number; y: number } {
    const pointerEvents = Array.from(this.pointers.values());
    return {
      x: (pointerEvents[0].clientX + pointerEvents[1].clientX) / 2,
      y: (pointerEvents[0].clientY + pointerEvents[1].clientY) / 2,
    };
  }

  private getActiveQuickBuildUnitType(): UnitType | null {
    for (const [code, unitType] of this.quickBuildHotkeys) {
      if (this.activeKeys.has(code)) {
        return unitType;
      }
    }
    return null;
  }

  private triggerQuickBuild(
    unitType: UnitType,
    clientX: number,
    clientY: number,
  ) {
    this.lastQuickBuildAttempt = {
      x: clientX,
      y: clientY,
    };
    this.eventBus.emit(new QuickBuildEvent(unitType, clientX, clientY));
  }

  destroy() {
    if (this.moveInterval !== null) {
      clearInterval(this.moveInterval);
    }
    this.eventBus.off(QuickBuildFailedEvent, this.handleQuickBuildFailure);
    this.activeKeys.clear();
    this.pendingQuickBuild = null;
    this.lastQuickBuildAttempt = null;
    this.pointerPositionKnown = false;
  }

  isModifierKeyPressed(event: PointerEvent): boolean {
    return (
      (this.keybinds.modifierKey === "AltLeft" && event.altKey) ||
      (this.keybinds.modifierKey === "ControlLeft" && event.ctrlKey) ||
      (this.keybinds.modifierKey === "ShiftLeft" && event.shiftKey) ||
      (this.keybinds.modifierKey === "MetaLeft" && event.metaKey)
    );
  }

  isAltKeyPressed(event: PointerEvent): boolean {
    return (
      (this.keybinds.altKey === "AltLeft" && event.altKey) ||
      (this.keybinds.altKey === "ControlLeft" && event.ctrlKey) ||
      (this.keybinds.altKey === "ShiftLeft" && event.shiftKey) ||
      (this.keybinds.altKey === "MetaLeft" && event.metaKey)
    );
  }
}
