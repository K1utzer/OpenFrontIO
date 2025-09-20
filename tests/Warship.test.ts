import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { ShellExecution } from "../src/core/execution/ShellExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

const coastX = 7;
let game: Game;
let player1: Player;
let player2: Player;

describe("Warship", () => {
  function countShellExecutions(): number {
    return game
      .executions()
      .filter((exec): exec is ShellExecution => exec instanceof ShellExecution)
      .length;
  }

  function oceanTileToTheRight(startX: number, y: number, minOffset: number) {
    let fallback: ReturnType<typeof game.ref> | undefined;
    for (let offset = 1; offset < game.width(); offset++) {
      if (startX + offset < game.width()) {
        const rightTile = game.ref(startX + offset, y);
        if (game.isOcean(rightTile)) {
          if (offset >= minOffset) {
            return rightTile;
          }
          fallback = rightTile;
        }
      }
      if (startX - offset >= 0) {
        const leftTile = game.ref(startX - offset, y);
        if (game.isOcean(leftTile)) {
          if (offset >= minOffset) {
            return leftTile;
          }
          fallback = leftTile;
        }
      }
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error("Failed to find ocean tile to the right");
  }

  function tickUntilShellCountAtLeast(
    expected: number,
    maxTicks: number = 200,
  ) {
    for (let i = 0; i < maxTicks; i++) {
      if (countShellExecutions() >= expected) {
        return;
      }
      executeTicks(game, 1);
    }
    throw new Error(`Expected at least ${expected} shell executions`);
  }

  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("boat dude", PlayerType.Human, null, "player_2_id"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  test("Warship heals only if player has port", async () => {
    const maxHealth = game.config().unitInfo(UnitType.Warship).maxHealth;
    if (typeof maxHealth !== "number") {
      expect(typeof maxHealth).toBe("number");
      throw new Error("unreachable");
    }

    const port = player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    game.executeNextTick();

    expect(warship.health()).toBe(maxHealth);
    warship.modifyHealth(-10);
    expect(warship.health()).toBe(maxHealth - 10);
    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);

    port.delete();

    game.executeNextTick();
    expect(warship.health()).toBe(maxHealth - 9);
  });

  test("Warship captures trade if player has port", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});
    game.addExecution(
      new WarshipExecution(
        player1.buildUnit(UnitType.Warship, portTile, {
          patrolTile: portTile,
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 7),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for A* to execute
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }
    expect(tradeShip.owner()).toBe(player1);
  });

  test("Warship do not capture trade if player has no port", async () => {
    game.addExecution(
      new WarshipExecution(
        player1.buildUnit(UnitType.Warship, game.ref(coastX + 1, 11), {
          patrolTile: game.ref(coastX + 1, 11),
        }),
      ),
    );

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 11),
      {
        targetUnit: player1.buildUnit(UnitType.Port, game.ref(coastX, 11), {}),
      },
    );

    expect(tradeShip.owner().id()).toBe(player2.id());
    // Let plenty of time for warship to potentially capture trade ship
    for (let i = 0; i < 10; i++) {
      game.executeNextTick();
    }

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship does not target trade ships that are safe from pirates", async () => {
    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 10),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    tradeShip.setSafeFromPirates();

    executeTicks(game, 10);

    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("Warship moves to new patrol tile", async () => {
    game.config().warshipTargettingRange = () => 1;

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );

    game.addExecution(new WarshipExecution(warship));

    game.addExecution(
      new MoveWarshipExecution(player1, warship.id(), game.ref(coastX + 5, 15)),
    );

    executeTicks(game, 10);

    expect(warship.patrolTile()).toBe(game.ref(coastX + 5, 15));
  });

  test("Warship does not not target trade ships outside of patrol range", async () => {
    game.config().warshipTargettingRange = () => 3;

    // build port so warship can target trade ships
    player1.buildUnit(UnitType.Port, game.ref(coastX, 10), {});

    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      {
        patrolTile: game.ref(coastX + 1, 10),
      },
    );
    game.addExecution(new WarshipExecution(warship));

    const tradeShip = player2.buildUnit(
      UnitType.TradeShip,
      game.ref(coastX + 1, 15),
      {
        targetUnit: player2.buildUnit(UnitType.Port, game.ref(coastX, 10), {}),
      },
    );

    executeTicks(game, 10);

    // Trade ship should not be captured
    expect(tradeShip.owner().id()).toBe(player2.id());
  });

  test("MoveWarshipExecution fails if player is not the owner", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    new MoveWarshipExecution(
      player2,
      warship.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails if warship is not active", async () => {
    const originalPatrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 5),
      {
        patrolTile: originalPatrolTile,
      },
    );
    warship.delete();
    new MoveWarshipExecution(
      player1,
      warship.id(),
      game.ref(coastX + 5, 15),
    ).init(game, 0);
    expect(warship.patrolTile()).toBe(originalPatrolTile);
  });

  test("MoveWarshipExecution fails gracefully if warship not found", async () => {
    const exec = new MoveWarshipExecution(
      player1,
      123,
      game.ref(coastX + 5, 15),
    );

    // Verify that no error is thrown.
    exec.init(game, 0);

    expect(exec.isActive()).toBe(false);
  });

  test("Warship fires two shells per volley", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});

    const patrolTile = game.ref(coastX + 1, 10);
    const warship = player1.buildUnit(UnitType.Warship, patrolTile, {
      patrolTile,
    });
    game.addExecution(new WarshipExecution(warship));

    const targetTile = oceanTileToTheRight(coastX, 10, 10);
    player2.buildUnit(UnitType.Warship, targetTile, { patrolTile: targetTile });

    const warmup = game.config().warshipShellAttackRate() + 5;
    executeTicks(game, warmup);
    tickUntilShellCountAtLeast(1);
    const afterFirstShot = countShellExecutions();
    expect(afterFirstShot).toBeGreaterThanOrEqual(1);

    executeTicks(game, 1);
    const afterSecondShot = countShellExecutions();
    expect(afterSecondShot).toBeGreaterThanOrEqual(2);
  });

  test("Missile warship fires a single shell per volley", async () => {
    const portTile = game.ref(coastX, 10);
    player1.buildUnit(UnitType.Port, portTile, {});

    const patrolTile = game.ref(coastX + 1, 10);
    const missileShip = player1.buildUnit(UnitType.MissileShip, patrolTile, {
      patrolTile,
    });
    game.addExecution(
      new WarshipExecution(missileShip, {
        unitType: UnitType.MissileShip,
        shellVolleySize: 1,
      }),
    );

    const targetTile = oceanTileToTheRight(coastX, 10, 10);
    player2.buildUnit(UnitType.Warship, targetTile, { patrolTile: targetTile });

    const warmup = game.config().warshipShellAttackRate() + 5;
    executeTicks(game, warmup);
    tickUntilShellCountAtLeast(1);
    const afterFirstShot = countShellExecutions();
    expect(afterFirstShot).toBeGreaterThanOrEqual(1);

    executeTicks(game, 1);
    const afterSecondTick = countShellExecutions();
    expect(afterSecondTick).toBeLessThanOrEqual(1);
  });
});
