import {
  Execution,
  Game,
  isStructureType,
  Player,
  TrajectoryTile,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { ParabolaPathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { NukeType } from "../StatsSchemas";

type RocketUnitType = UnitType.ClusterRocket | UnitType.TacticalRocket;

type RocketConfig = {
  speed: number;
  blastRadius: number;
  troopDamage: number;
  burstCount: number;
  spread: number;
};

const rocketConfig: Record<RocketUnitType, RocketConfig> = {
  [UnitType.ClusterRocket]: {
    speed: 8,
    blastRadius: 2,
    troopDamage: 300,
    burstCount: 5,
    spread: 3,
  },
  [UnitType.TacticalRocket]: {
    speed: 12,
    blastRadius: 1,
    troopDamage: 450,
    burstCount: 1,
    spread: 0,
  },
};

export class RocketExecution implements Execution {
  private active = true;
  private mg: Game;
  private rocket: Unit | null = null;
  private pathFinder: ParabolaPathFinder;
  private random: PseudoRandom;

  constructor(
    private readonly rocketType: RocketUnitType,
    private player: Player,
    private readonly dst: TileRef,
    private src?: TileRef | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new ParabolaPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
  }

  tick(ticks: number): void {
    if (this.rocket === null) {
      const spawn = this.src ?? this.player.canBuild(this.rocketType, this.dst);
      if (spawn === false) {
        console.warn(`cannot build rocket ${this.rocketType}`);
        this.active = false;
        return;
      }
      this.src = spawn;
      const config = rocketConfig[this.rocketType];
      this.pathFinder.computeControlPoints(spawn, this.dst, config.speed, true);
      this.rocket = this.player.buildUnit(this.rocketType, spawn, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });

      if (this.mg.hasOwner(this.dst)) {
        const target = this.mg.owner(this.dst);
        if (target.isPlayer()) {
          this.mg
            .stats()
            .bombLaunch(this.player, target, this.rocketType as NukeType);
        }
      }
      return;
    }

    if (!this.rocket.isActive()) {
      this.active = false;
      return;
    }

    const config = rocketConfig[this.rocketType];
    const nextTile = this.pathFinder.nextTile(config.speed);
    if (nextTile === true) {
      this.detonate();
      return;
    } else {
      this.updateRocketTargetable();
      this.rocket.move(nextTile);
      this.rocket.setTrajectoryIndex(this.pathFinder.currentIndex());
    }
  }

  private getTrajectory(target: TileRef): TrajectoryTile[] {
    const trajectoryTiles: TrajectoryTile[] = [];
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const allTiles: TileRef[] = this.pathFinder.allTiles();
    for (const tile of allTiles) {
      trajectoryTiles.push({
        tile,
        targetable: this.isTargetable(target, tile, targetRangeSquared),
      });
    }

    return trajectoryTiles;
  }

  private isTargetable(
    targetTile: TileRef,
    rocketTile: TileRef,
    targetRangeSquared: number,
  ): boolean {
    return (
      this.mg.euclideanDistSquared(rocketTile, targetTile) <
        targetRangeSquared ||
      (this.src !== undefined &&
        this.src !== null &&
        this.mg.euclideanDistSquared(this.src, rocketTile) < targetRangeSquared)
    );
  }

  private updateRocketTargetable() {
    if (this.rocket === null || this.rocket.targetTile() === undefined) {
      return;
    }
    const targetRangeSquared =
      this.mg.config().defaultNukeTargetableRange() ** 2;
    const targetTile = this.rocket.targetTile();
    this.rocket.setTargetable(
      this.isTargetable(targetTile!, this.rocket.tile(), targetRangeSquared),
    );
  }

  private detonate() {
    if (this.rocket === null) {
      throw new Error("Rocket not initialized");
    }

    const config = rocketConfig[this.rocketType];
    const blasts = new Set<TileRef>();
    blasts.add(this.dst);

    for (let i = 1; i < config.burstCount; i++) {
      const offsetX = this.random.nextInt(-config.spread, config.spread);
      const offsetY = this.random.nextInt(-config.spread, config.spread);
      const x = this.mg.x(this.dst) + offsetX;
      const y = this.mg.y(this.dst) + offsetY;
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      blasts.add(this.mg.ref(x, y));
    }

    for (const blast of blasts) {
      this.applyBlast(blast, config.blastRadius, config.troopDamage);
    }

    this.redrawBuildings(config.blastRadius + 4);

    this.active = false;
    this.rocket.setReachedTarget();
    this.rocket.delete(false);

    if (this.mg.hasOwner(this.dst)) {
      const target = this.mg.owner(this.dst);
      if (target.isPlayer()) {
        this.mg
          .stats()
          .bombLand(this.player, target, this.rocketType as NukeType);
      }
    }
  }

  private applyBlast(center: TileRef, radius: number, troopDamage: number) {
    const radiusSquared = radius * radius;
    const tiles = this.mg.bfs(center, (gm, tile) => {
      return gm.euclideanDistSquared(center, tile) <= radiusSquared;
    });

    for (const tile of tiles) {
      if (!this.mg.hasOwner(tile)) {
        continue;
      }
      const owner = this.mg.owner(tile);
      if (owner.isPlayer()) {
        owner.removeTroops(Math.min(troopDamage, owner.troops()));
      }
    }

    for (const unit of this.mg.units()) {
      if (
        unit.type() === UnitType.ClusterRocket ||
        unit.type() === UnitType.TacticalRocket ||
        unit.type() === UnitType.MIRVWarhead ||
        unit.type() === UnitType.MIRV
      ) {
        continue;
      }
      if (this.mg.euclideanDistSquared(center, unit.tile()) <= radiusSquared) {
        unit.delete(true, this.player);
      }
    }
  }

  private redrawBuildings(range: number) {
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (isStructureType(unit.type())) {
        if (
          this.mg.euclideanDistSquared(this.dst, unit.tile()) < rangeSquared
        ) {
          unit.touch();
        }
      }
    }
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
