/**
 * @jest-environment jsdom
 */
jest.mock("lit", () => {
  class MockLitElement {
    requestUpdate() {}
  }
  return {
    LitElement: MockLitElement,
    html: () => "",
    css: () => "",
  };
});

jest.mock("lit/decorators.js", () => ({
  customElement: () => () => undefined,
  state: () => () => undefined,
}));

jest.mock("../../../src/client/Transport", () => ({
  BuildUnitIntentEvent: class BuildUnitIntentEvent {
    unit: unknown;
    tile: unknown;

    constructor(unit: unknown, tile: unknown) {
      this.unit = unit;
      this.tile = tile;
    }
  },
  SendUpgradeStructureIntentEvent: class SendUpgradeStructureIntentEvent {
    unitId: unknown;
    unitType: unknown;

    constructor(unitId: unknown, unitType: unknown) {
      this.unitId = unitId;
      this.unitType = unitType;
    }
  },
}));

import {
  BuildMenu,
  flattenedBuildTable,
} from "../../../src/client/graphics/layers/BuildMenu";
import {
  QuickBuildEvent,
  QuickBuildFailedEvent,
} from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import {
  BuildableUnit,
  PlayerActions,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { GameView, PlayerView } from "../../../src/core/game/GameView";

describe("BuildMenu quick build", () => {
  function setupQuickBuildTest(overrides: Partial<BuildableUnit> = {}) {
    const eventBus = new EventBus();
    const buildMenu = new BuildMenu();
    // Prevent Lit from scheduling renders during tests
    (buildMenu as unknown as { requestUpdate: () => void }).requestUpdate =
      jest.fn();

    const tile = 321 as TileRef;
    const buildableUnit: BuildableUnit = {
      type: overrides.type ?? UnitType.Port,
      canBuild: overrides.canBuild ?? tile,
      canUpgrade: overrides.canUpgrade ?? false,
      cost: overrides.cost ?? 0n,
    };

    const refMock = jest.fn(() => tile);
    const actionsMock = jest.fn<Promise<PlayerActions>, [TileRef]>(() =>
      Promise.resolve({
        canAttack: false,
        canSendEmojiAllPlayers: false,
        buildableUnits: [buildableUnit],
      }),
    );

    const player = {
      isAlive: () => true,
      actions: actionsMock,
    } as unknown as PlayerView;

    const game = {
      myPlayer: () => player,
      isValidCoord: jest.fn(() => true),
      ref: refMock,
      config: () => ({ isUnitDisabled: () => false }),
    } as unknown as GameView;

    const transformHandler = {
      screenToWorldCoordinates: jest.fn(() => ({ x: 4, y: 5 })),
    } as any;

    buildMenu.game = game;
    buildMenu.eventBus = eventBus;
    buildMenu.transformHandler = transformHandler;

    buildMenu.init();

    return { eventBus, buildMenu, actionsMock, refMock, tile, buildableUnit };
  }

  it("emits a build intent when the quick build hotkey is available", async () => {
    const { eventBus, actionsMock, refMock, tile, buildableUnit } =
      setupQuickBuildTest();

    const emitSpy = jest.spyOn(eventBus, "emit");
    eventBus.emit(new QuickBuildEvent(buildableUnit.type, 10, 20));

    await Promise.resolve();
    await Promise.resolve();

    expect(actionsMock).toHaveBeenCalledWith(tile);
    expect(refMock).toHaveBeenCalledWith(4, 5);

    const buildEventCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof BuildUnitIntentEvent,
    );
    expect(buildEventCall).toBeDefined();
    const buildEvent = buildEventCall![0] as BuildUnitIntentEvent;
    expect(buildEvent.unit).toBe(buildableUnit.type);
    expect(buildEvent.tile).toBe(tile);

    const failureCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof QuickBuildFailedEvent,
    );
    expect(failureCall).toBeUndefined();
  });

  it("does not emit when the structure cannot be built or upgraded", async () => {
    const { eventBus, buildableUnit } = setupQuickBuildTest({
      canBuild: false,
      canUpgrade: false,
    });

    const emitSpy = jest.spyOn(eventBus, "emit");
    eventBus.emit(new QuickBuildEvent(buildableUnit.type, 10, 20));

    await Promise.resolve();
    await Promise.resolve();

    const buildEventCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof BuildUnitIntentEvent,
    );
    expect(buildEventCall).toBeUndefined();

    const failureCall = emitSpy.mock.calls.find(
      ([event]) => event instanceof QuickBuildFailedEvent,
    );
    expect(failureCall).toBeDefined();
    const failureEvent = failureCall![0] as QuickBuildFailedEvent;
    expect(failureEvent.x).toBe(10);
    expect(failureEvent.y).toBe(20);
  });
  it("includes missile ship and rockets in the build table", () => {
    const unitTypes = flattenedBuildTable.map((entry) => entry.unitType);
    expect(unitTypes).toContain(UnitType.MissileShip);
    expect(unitTypes).toContain(UnitType.ClusterRocket);
    expect(unitTypes).toContain(UnitType.TacticalRocket);
  });
});
