import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostResourcesSnapshot } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/process";

import * as HostResources from "./HostResources.ts";

const decodeSnapshot = Schema.decodeUnknownSync(HostResourcesSnapshot);
const isSnapshot = Schema.is(HostResourcesSnapshot);

const vmStat = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free: 10.
Pages inactive: 20.
Pages speculative: 5.
Pages wired down: 40.
Pages stored in compressor: 100.
Pages occupied by compressor: 30.
Swapins: 2.
Swapouts: 3.`;

describe("host memory metrics", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["1\n", "normal"],
    ["2", "warning"],
    ["4", "critical"],
    ["3", null],
    ["", null],
    ["unavailable", null],
  ])("maps OS pressure %s to %s", (input, expected) => {
    expect(HostResources.parseDarwinMemoryPressure(input ?? "")).toBe(expected);
  });

  it("reads physical compressor pages, wired pages, and swap counters", () => {
    expect(HostResources.parseDarwinVmStat(vmStat)).toEqual({
      pageSize: 16384,
      availableBytes: 35 * 16384,
      compressedBytes: 30 * 16384,
      wiredBytes: 40 * 16384,
      swapReadBytes: 2 * 16384,
      swapWriteBytes: 3 * 16384,
    });
  });

  it("keeps missing or invalid metrics unavailable and preserves zero values", () => {
    expect(HostResources.parseDarwinVmStat("Pages wired down: 40.").wiredBytes).toBeNull();
    expect(
      HostResources.parseDarwinVmStat(vmStat.replace("16384", "0")).compressedBytes,
    ).toBeNull();
    const partial = HostResources.parseDarwinVmStat(
      vmStat.replace("Pages free: 10.", "Pages free: invalid."),
    );
    expect(partial.availableBytes).toBeNull();
    expect(partial.compressedBytes).toBe(30 * 16384);
    expect(
      HostResources.parseDarwinVmStat(vmStat.replace("Swapins: 2.", "Swapins: 0.")).swapReadBytes,
    ).toBe(0);
    expect(
      HostResources.parseDarwinVmStat(vmStat.replace("Swapouts: 3.", "Swapouts: 9007199254740992."))
        .swapWriteBytes,
    ).toBeNull();
  });

  it("parses decimal swap usage with binary units", () => {
    expect(
      HostResources.parseDarwinSwapUsage(
        "total = 4096.00M used = 512.50M free = 3583.50M (encrypted)",
      ),
    ).toEqual({
      swapTotalBytes: 4096 * 1024 ** 2,
      swapUsedBytes: 512.5 * 1024 ** 2,
    });
    expect(HostResources.parseDarwinSwapUsage("total = 0.00M used = 0.00M")).toEqual({
      swapTotalBytes: 0,
      swapUsedBytes: 0,
    });
    expect(HostResources.parseDarwinSwapUsage("total = invalid used = -1M")).toEqual({
      swapTotalBytes: null,
      swapUsedBytes: null,
    });
    expect(HostResources.parseDarwinSwapUsage("used = 9007199254740992M").swapUsedBytes).toBeNull();
  });

  it("calculates swap rates from counter changes and elapsed time", () => {
    const previous = {
      timeNanos: 1_000_000_000n,
      pageSize: 16384,
      swapReadBytes: 32768,
      swapWriteBytes: 49152,
    };
    const current = {
      ...previous,
      timeNanos: 6_000_000_000n,
      swapReadBytes: 65536,
      swapWriteBytes: 98304,
    };
    expect(HostResources.calculateSwapRates(current, previous)).toEqual({
      swapReadBytesPerSecond: 32768 / 5,
      swapWriteBytesPerSecond: 49152 / 5,
    });
    expect(
      HostResources.calculateSwapRates({ ...previous, timeNanos: current.timeNanos }, previous),
    ).toEqual({ swapReadBytesPerSecond: 0, swapWriteBytesPerSecond: 0 });
  });

  it("does not invent rates for first samples, resets, missing counters, or invalid time", () => {
    const current = {
      timeNanos: 6_000_000_000n,
      pageSize: 16384,
      swapReadBytes: 65536,
      swapWriteBytes: 98304,
    };
    const unavailable = { swapReadBytesPerSecond: null, swapWriteBytesPerSecond: null };
    expect(HostResources.calculateSwapRates(current, null)).toEqual(unavailable);
    expect(HostResources.calculateSwapRates(current, current)).toEqual(unavailable);
    expect(
      HostResources.calculateSwapRates(current, { ...current, timeNanos: 7_000_000_000n }),
    ).toEqual(unavailable);
    expect(
      HostResources.calculateSwapRates(current, { ...current, timeNanos: 1n, pageSize: 4096 }),
    ).toEqual(unavailable);
    expect(
      HostResources.calculateSwapRates(current, {
        ...current,
        timeNanos: 1n,
        swapReadBytes: 999999,
        swapWriteBytes: null,
      }),
    ).toEqual(unavailable);
    expect(
      HostResources.calculateSwapRates(
        { ...current, swapReadBytes: null },
        { ...current, timeNanos: 1n },
      ),
    ).toEqual({ swapReadBytesPerSecond: null, swapWriteBytesPerSecond: 0 });
  });

  it("accepts host snapshots from older servers", () => {
    const snapshot = {
      sampledAt: 1000,
      cpuUtilization: null,
      cpuCount: 8,
      availableMemoryBytes: 100,
      totalMemoryBytes: 200,
    };
    expect(decodeSnapshot(snapshot)).toEqual(snapshot);
  });

  it.live("shares one sample across callers and isolates failed OS reads", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const string = vi.spyOn(spawner, "string").mockImplementation((command) => {
        if (command._tag === "StandardCommand" && command.command === "/usr/bin/vm_stat")
          return Effect.succeed(vmStat);
        if (command._tag === "StandardCommand" && command.args.includes("vm.swapusage"))
          return Effect.succeed("total = 4096.00M used = 512.50M");
        return Effect.fail(
          PlatformError.systemError({
            module: "ChildProcess",
            method: "spawn",
            _tag: "NotFound",
            cause: new Error("Read fails"),
          }),
        );
      });
      const service = yield* HostResources.HostResources;
      const samples = yield* Effect.all([service.read, service.read, service.read], {
        concurrency: "unbounded",
      });
      expect(string).toHaveBeenCalledTimes(3);
      expect(samples[0]).toBe(samples[1]);
      expect(samples[1]).toBe(samples[2]);
      expect(samples[0]?.memory).toEqual({
        pressure: null,
        compressedBytes: 30 * 16384,
        wiredBytes: 40 * 16384,
        swapUsedBytes: 512.5 * 1024 ** 2,
        swapTotalBytes: 4096 * 1024 ** 2,
        swapReadBytesPerSecond: null,
        swapWriteBytesPerSecond: null,
      });
      expect(isSnapshot(samples[0])).toBe(true);
    }).pipe(
      Effect.provide(HostResources.layer),
      Effect.provideService(HostProcessPlatform, "darwin"),
      Effect.provide(NodeServices.layer),
    ),
  );

  it.live("reads the current host through the OS services", () =>
    Effect.gen(function* () {
      const service = yield* HostResources.HostResources;
      const sample = yield* service.read;
      expect(isSnapshot(sample)).toBe(true);
      expect(sample.totalMemoryBytes).toBeGreaterThan(0);
      expect(sample.sampledAt).toBeGreaterThan(0);
      expect(sample.memory?.swapReadBytesPerSecond).toBeNull();
      expect(sample.memory?.swapWriteBytesPerSecond).toBeNull();
    }).pipe(Effect.provide(HostResources.layer), Effect.provide(NodeServices.layer)),
  );

  it.live("reads Linux swap totals and keeps unsupported metrics unavailable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      vi.spyOn(fs, "readFileString").mockReturnValue(
        Effect.succeed("MemAvailable: 10 kB\nSwapTotal: 100 kB\nSwapFree: 75 kB\n"),
      );
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const string = vi.spyOn(spawner, "string");
      const service = yield* HostResources.HostResources;
      const sample = yield* service.read;
      expect(sample.availableMemoryBytes).toBe(10 * 1024);
      expect(sample.memory).toEqual({
        pressure: null,
        compressedBytes: null,
        wiredBytes: null,
        swapUsedBytes: 25 * 1024,
        swapTotalBytes: 100 * 1024,
        swapReadBytesPerSecond: null,
        swapWriteBytesPerSecond: null,
      });
      expect(string).not.toHaveBeenCalled();
    }).pipe(
      Effect.provide(HostResources.layer),
      Effect.provideService(HostProcessPlatform, "linux"),
      Effect.provide(NodeServices.layer),
    ),
  );
});
