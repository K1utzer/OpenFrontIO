import { RocketExecution } from "../src/core/execution/RocketExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  TileRef,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player1: Player;
let player2: Player;
let player1PortTile: TileRef;
let player2LandTile: TileRef;

async function initGame() {
  game = await setup(
    "half_land_half_ocean",
    {
      infiniteGold: true,
      instantBuild: true,
    },
    [
      new PlayerInfo("rocketeer", PlayerType.Human, null, "player_1_id"),
      new PlayerInfo("defender", PlayerType.Human, null, "player_2_id"),
    ],
  );

  while (game.inSpawnPhase()) {
    game.executeNextTick();
  }

  player1 = game.player("player_1_id");
  player2 = game.player("player_2_id");

  player1PortTile = claimLandFor(player1, 0, 1, (tile) =>
    game.isOceanShore(tile),
  );
  player2LandTile = claimLandFor(player2, game.width() - 1, -1);
}

function claimLandFor(
  player: Player,
  startX: number,
  direction: 1 | -1,
  predicate: (tile: TileRef) => boolean = () => true,
): TileRef {
  for (let x = startX; x >= 0 && x < game.width(); x += direction) {
    for (let y = 0; y < game.height(); y++) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile)) {
        continue;
      }
      if (game.owner(tile).isPlayer()) {
        continue;
      }
      if (!predicate(tile)) {
        continue;
      }
      player.conquer(tile);
      return tile;
    }
  }
  throw new Error("unable to find land for player");
}

function prepareMissileShip(): {
  missileShipTile: TileRef;
  patrol: TileRef;
} {
  const portTile = player1PortTile;
  player1.buildUnit(UnitType.Port, portTile, {});

  const patrolTile = game
    .neighbors(portTile)
    .find((tile) => game.isOcean(tile));
  if (patrolTile === undefined) {
    throw new Error("expected shoreline port tile to touch ocean");
  }
  const missileShip = player1.buildUnit(UnitType.MissileShip, patrolTile, {
    patrolTile,
  });
  game.addExecution(
    new WarshipExecution(missileShip, {
      unitType: UnitType.MissileShip,
      allowShells: false,
    }),
  );
  return { missileShipTile: missileShip.tile(), patrol: patrolTile };
}

describe("RocketExecution", () => {
  beforeEach(async () => {
    await initGame();
  });

  test("cluster rockets require an active missile ship", () => {
    expect(player1.canBuild(UnitType.ClusterRocket, player2LandTile)).toBe(
      false,
    );

    const { missileShipTile } = prepareMissileShip();

    const spawn = player1.canBuild(UnitType.ClusterRocket, player2LandTile);
    expect(spawn).toBe(missileShipTile);
  });

  test("cluster rocket damages units without changing ownership", () => {
    const { missileShipTile } = prepareMissileShip();

    const city = player2.buildUnit(UnitType.City, player2LandTile, {});

    game.addExecution(
      new RocketExecution(
        UnitType.ClusterRocket,
        player1,
        player2LandTile,
        missileShipTile,
      ),
    );

    executeTicks(game, 200);

    expect(city.isActive()).toBe(false);
    expect(game.owner(player2LandTile)).toBe(player2);
  });

  test("tactical rocket keeps land ownership intact", () => {
    const { missileShipTile } = prepareMissileShip();

    game.addExecution(
      new RocketExecution(
        UnitType.TacticalRocket,
        player1,
        player2LandTile,
        missileShipTile,
      ),
    );

    const ownerBefore = game.owner(player2LandTile);
    executeTicks(game, 200);

    expect(game.owner(player2LandTile)).toBe(ownerBefore);
  });
});
