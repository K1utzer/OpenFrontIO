import {
  Execution,
  Game,
  isStructureType,
  Player,
  TerraNullius,
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
  bursts: { min: number; max: number };
  spread: number;
  minClusterSpacing?: number;
};

interface RocketExecutionOptions {
  skipSpawnChecks?: boolean;
  skipLaunchCooldown?: boolean;
  skipCost?: boolean;
  skipStats?: boolean;
  isClusterBomblet?: boolean;
}

const CLUSTER_BOMBLET_COUNT = 5;

const rocketConfig: Record<RocketUnitType, RocketConfig> = {
  [UnitType.ClusterRocket]: {
    speed: 8,
    blastRadius: 1,
    troopDamage: 350,
    bursts: { min: 3, max: 5 },
    spread: 26,
    minClusterSpacing: 10,
  },
  [UnitType.TacticalRocket]: {
    speed: 12,
    blastRadius: 1,
    troopDamage: 450,
    bursts: { min: 1, max: 1 },
    spread: 0,
  },
};

export class RocketExecution implements Execution {
  private active = true;
  private mg: Game;
  private rocket: Unit | null = null;
  private carrier: Unit | null = null;
  private pathFinder: ParabolaPathFinder;
  private random: PseudoRandom;

  constructor(
    private readonly rocketType: RocketUnitType,
    private player: Player,
    private readonly dst: TileRef,
    private src?: TileRef | null,
    private readonly options: RocketExecutionOptions = {},
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new ParabolaPathFinder(mg);
    this.random = new PseudoRandom(mg.ticks());
  }

  tick(ticks: number): void {
    if (this.rocket === null) {
      let spawn: TileRef | false;
      if (this.options.skipSpawnChecks) {
        if (this.src === undefined || this.src === null) {
          console.warn(`missing spawn tile for rocket ${this.rocketType}`);
          this.active = false;
          return;
        }
        spawn = this.src;
      } else {
        spawn = this.src ?? this.player.canBuild(this.rocketType, this.dst);
        if (spawn === false) {
          console.warn(`cannot build rocket ${this.rocketType}`);
          this.active = false;
          return;
        }
      }
      if (spawn === false) {
        console.warn(`cannot determine spawn for rocket ${this.rocketType}`);
        this.active = false;
        return;
      }
      this.src = spawn;
      if (!this.options.skipSpawnChecks) {
        this.carrier ??= this.findCarrier(spawn);
        if (this.carrier === null) {
          console.warn(`no missile ship available for ${this.rocketType}`);
          this.active = false;
          return;
        }
        if (this.carrier.isInCooldown()) {
          console.warn(`missile ship on cooldown for ${this.rocketType}`);
          this.active = false;
          return;
        }
      }
      const config = rocketConfig[this.rocketType];
      this.pathFinder.computeControlPoints(spawn, this.dst, config.speed, true);
      const goldBefore = this.player.gold();
      this.rocket = this.player.buildUnit(this.rocketType, spawn, {
        targetTile: this.dst,
        trajectory: this.getTrajectory(this.dst),
      });
      if (this.options.skipCost) {
        const spentGold = goldBefore - this.player.gold();
        if (spentGold > 0n) {
          this.player.addGold(spentGold);
        }
      }

      if (!this.options.skipLaunchCooldown && this.carrier !== null) {
        this.carrier.launch();
      }

      if (!this.options.skipStats && this.mg.hasOwner(this.dst)) {
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

    if (
      this.rocketType === UnitType.ClusterRocket &&
      !this.options.isClusterBomblet
    ) {
      this.splitClusterRocket(config);
      return;
    }

    const blasts: TileRef[] = [];
    const seen = new Set<TileRef>();
    const addBlast = (tile: TileRef) => {
      if (seen.has(tile)) {
        return;
      }
      seen.add(tile);
      blasts.push(tile);
    };

    if (this.rocketType === UnitType.ClusterRocket) {
      addBlast(this.dst);
    } else {
      addBlast(this.dst);
      const baseX = this.mg.x(this.dst);
      const baseY = this.mg.y(this.dst);

      if (config.spread > 0) {
        const totalBlasts = this.randomBurstCount(config);
        let attempts = 0;
        const maxAttempts = totalBlasts * 8;
        while (blasts.length < totalBlasts && attempts < maxAttempts) {
          attempts++;
          const distance = this.random.nextFloat(0, config.spread);
          const angle = this.random.nextFloat(0, Math.PI * 2);
          const offsetX = Math.round(Math.cos(angle) * distance);
          const offsetY = Math.round(Math.sin(angle) * distance);
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const x = baseX + offsetX;
          const y = baseY + offsetY;
          if (!this.mg.isValidCoord(x, y)) {
            continue;
          }
          addBlast(this.mg.ref(x, y));
        }
      }
    }

    if (this.rocket.tile() !== this.dst) {
      this.rocket.move(this.dst);
    }
    this.rocket.setPayloadTiles(blasts);

    for (const blast of blasts) {
      this.applyBlast(blast, config.blastRadius, config.troopDamage);
    }

    this.redrawBuildings(config.blastRadius + 4, blasts);

    this.active = false;
    this.rocket.setReachedTarget();
    this.rocket.delete(false);

    if (!this.options.skipStats && this.mg.hasOwner(this.dst)) {
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

  private redrawBuildings(range: number, centers: TileRef[]) {
    const rangeSquared = range * range;
    for (const unit of this.mg.units()) {
      if (!isStructureType(unit.type())) {
        continue;
      }
      for (const center of centers) {
        if (this.mg.euclideanDistSquared(center, unit.tile()) < rangeSquared) {
          unit.touch();
          break;
        }
      }
    }
  }

  private randomBurstCount(config: RocketConfig): number {
    const { min, max } = config.bursts;
    if (min >= max) {
      return Math.max(min, 1);
    }
    return this.random.nextInt(min, max + 1);
  }

  private splitClusterRocket(config: RocketConfig) {
    if (this.rocket === null) {
      throw new Error("Rocket not initialized");
    }

    const origin = this.rocket.tile();
    const clusterTargets = this.generateClusterBlasts(
      config,
      CLUSTER_BOMBLET_COUNT,
    );

    for (const target of clusterTargets) {
      this.mg.addExecution(
        new RocketExecution(
          UnitType.ClusterRocket,
          this.player,
          target,
          origin,
          {
            skipSpawnChecks: true,
            skipLaunchCooldown: true,
            skipCost: true,
            skipStats: true,
            isClusterBomblet: true,
          },
        ),
      );
    }

    this.active = false;
    this.rocket.setPayloadTiles([]);
    this.rocket.setReachedTarget();
    this.rocket.delete(false);
    this.rocket = null;

    if (!this.options.skipStats && this.mg.hasOwner(this.dst)) {
      const target = this.mg.owner(this.dst);
      if (target.isPlayer()) {
        this.mg
          .stats()
          .bombLand(this.player, target, this.rocketType as NukeType);
      }
    }
  }

  private generateClusterBlasts(
    config: RocketConfig,
    desiredBlasts: number,
  ): TileRef[] {
    const blasts: TileRef[] = [];
    const seen = new Set<TileRef>();

    const baseX = this.mg.x(this.dst);
    const baseY = this.mg.y(this.dst);
    const preferLand = this.mg.isLand(this.dst);
    const targetOwner = this.mg.hasOwner(this.dst)
      ? this.mg.owner(this.dst)
      : null;

    const minSpacing = Math.max(
      4,
      config.minClusterSpacing ?? Math.floor(Math.max(config.spread, 1) / 3),
    );
    const minSpacingSquared = minSpacing * minSpacing;
    const maxAttempts = Math.max(20, desiredBlasts * 60);

    const addIfValid = (tile: TileRef | null, enforceSpacing = true) => {
      if (tile === null) {
        return false;
      }
      if (seen.has(tile)) {
        return false;
      }
      if (
        enforceSpacing &&
        blasts.some(
          (existing) =>
            this.mg.euclideanDistSquared(existing, tile) < minSpacingSquared,
        )
      ) {
        return false;
      }
      seen.add(tile);
      blasts.push(tile);
      return true;
    };

    addIfValid(this.dst, false);

    if (targetOwner !== null && targetOwner.isPlayer()) {
      const playerOwner = targetOwner;
      const maxDistanceSquared =
        config.spread > 0
          ? config.spread * config.spread
          : Number.POSITIVE_INFINITY;
      const ownerTargets: TileRef[] = [];
      for (const unit of this.mg.units()) {
        if (!unit.isActive() || unit.owner() !== playerOwner) {
          continue;
        }
        if (
          unit.type() === UnitType.ClusterRocket ||
          unit.type() === UnitType.TacticalRocket ||
          unit.type() === UnitType.MIRVWarhead ||
          unit.type() === UnitType.MIRV
        ) {
          continue;
        }
        if (
          config.spread > 0 &&
          this.mg.euclideanDistSquared(unit.tile(), this.dst) >
            maxDistanceSquared
        ) {
          continue;
        }
        ownerTargets.push(unit.tile());
      }

      ownerTargets.sort(
        (a, b) =>
          this.mg.euclideanDistSquared(b, this.dst) -
          this.mg.euclideanDistSquared(a, this.dst),
      );

      for (const tile of ownerTargets) {
        if (blasts.length >= desiredBlasts) {
          break;
        }
        addIfValid(tile);
      }
    }

    let attempts = 0;
    while (blasts.length < desiredBlasts && attempts < maxAttempts) {
      attempts++;
      const ignoreOwner = attempts > maxAttempts / 2;
      const candidate = this.randomClusterTarget(
        baseX,
        baseY,
        config.spread,
        ignoreOwner ? null : targetOwner,
        preferLand,
      );
      addIfValid(candidate);
    }

    if (blasts.length < desiredBlasts) {
      let fallbackAttempts = maxAttempts;
      while (blasts.length < desiredBlasts && fallbackAttempts > 0) {
        fallbackAttempts--;
        const ignoreOwner = fallbackAttempts < maxAttempts / 2;
        const candidate = this.randomClusterTarget(
          baseX,
          baseY,
          config.spread,
          ignoreOwner ? null : targetOwner,
          preferLand,
        );
        addIfValid(candidate, false);
      }
    }

    if (blasts.length === 0) {
      blasts.push(this.dst);
    }

    return blasts;
  }

  private randomClusterTarget(
    baseX: number,
    baseY: number,
    spread: number,
    targetOwner: Player | TerraNullius | null,
    preferLand: boolean,
  ): TileRef | null {
    if (spread <= 0) {
      return this.dst;
    }

    const minX = baseX - spread;
    const maxX = baseX + spread;
    const minY = baseY - spread;
    const maxY = baseY + spread;
    const maxLocalAttempts = 80;
    const maxDistanceSquared = spread * spread;

    for (let tries = 0; tries < maxLocalAttempts; tries++) {
      const x = this.random.nextInt(minX, maxX + 1);
      const y = this.random.nextInt(minY, maxY + 1);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (preferLand && !this.mg.isLand(tile)) {
        continue;
      }
      if (
        spread > 0 &&
        this.mg.euclideanDistSquared(tile, this.dst) > maxDistanceSquared
      ) {
        continue;
      }
      if (
        targetOwner !== null &&
        targetOwner.isPlayer() &&
        (!this.mg.hasOwner(tile) || this.mg.owner(tile) !== targetOwner)
      ) {
        continue;
      }
      return tile;
    }

    return null;
  }

  private findCarrier(spawn: TileRef): Unit | null {
    const carriers = this.player
      .units(UnitType.MissileShip)
      .filter(
        (ship) =>
          ship.isActive() &&
          ship.tile() === spawn &&
          ship.owner() === this.player,
      );
    return carriers[0] ?? null;
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
