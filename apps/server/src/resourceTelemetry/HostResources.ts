import * as NodeOS from "node:os";
import type { HostResourcesSnapshot } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class HostResources extends Context.Service<
  HostResources,
  { readonly read: Effect.Effect<HostResourcesSnapshot> }
>()("t3/resourceTelemetry/HostResources") {}

function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

function nonNegativeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseDarwinMemoryPressure(output: string) {
  switch (output.trim()) {
    case "1":
      return "normal";
    case "2":
      return "warning";
    case "4":
      return "critical";
    default:
      return null;
  }
}

export function parseDarwinVmStat(output: string) {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1]);
  const bytes = (label: string) => {
    const value = new RegExp(`^${label}:\\s+(\\d+)\\.$`, "m").exec(output)?.[1];
    return value !== undefined && Number.isSafeInteger(pageSize) && pageSize > 0
      ? nonNegativeInteger(Number(value) * pageSize)
      : null;
  };
  const free = bytes("Pages free");
  const inactive = bytes("Pages inactive");
  const speculative = bytes("Pages speculative");
  return {
    // vm_stat excludes speculative pages from its printed free page count.
    availableBytes:
      free !== null && inactive !== null && speculative !== null
        ? nonNegativeInteger(free + inactive + speculative)
        : null,
    compressedBytes: bytes("Pages occupied by compressor"),
    wiredBytes: bytes("Pages wired down"),
    swapReadBytes: bytes("Swapins"),
    swapWriteBytes: bytes("Swapouts"),
    pageSize,
  };
}

export function parseDarwinSwapUsage(output: string) {
  const bytes = (label: string) => {
    const match = new RegExp(`\\b${label} = (\\d+(?:\\.\\d+)?)([KMGTP]?)\\b`).exec(output);
    if (!match) return null;
    const exponent = " KMGTP".indexOf(match[2] || " ");
    return nonNegativeInteger(Math.round(Number(match[1]) * 1024 ** exponent));
  };
  return { swapUsedBytes: bytes("used"), swapTotalBytes: bytes("total") };
}

type SwapCounters = {
  readonly timeNanos: bigint;
  readonly pageSize: number;
  readonly swapReadBytes: number | null;
  readonly swapWriteBytes: number | null;
};

export function calculateSwapRates(current: SwapCounters, previous: SwapCounters | null) {
  const elapsedSeconds = previous ? Number(current.timeNanos - previous.timeNanos) / 1e9 : 0;
  const rate = (value: number | null, before: number | null | undefined) =>
    previous !== null &&
    current.pageSize === previous.pageSize &&
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds > 0 &&
    value !== null &&
    before !== null &&
    before !== undefined &&
    value >= before
      ? (value - before) / elapsedSeconds
      : null;
  return {
    swapReadBytesPerSecond: rate(current.swapReadBytes, previous?.swapReadBytes),
    swapWriteBytesPerSecond: rate(current.swapWriteBytes, previous?.swapWriteBytes),
  };
}

const make = Effect.fn("makeHostResources")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  let previousSwap: SwapCounters | null = null;
  const readCommand = (command: string, args: string[]) =>
    spawner.string(ChildProcess.make(command, args, { stdin: "ignore", stderr: "ignore" })).pipe(
      Effect.timeout("1 second"),
      Effect.orElseSucceed(() => ""),
    );

  const sample = Effect.fn("HostResources.sample")(function* () {
    const previousCpu = readCpu();
    // CPU counters need two readings; idle servers do no polling or process scans.
    yield* Effect.sleep("200 millis");
    const cpu = readCpu();
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    const cpuUtilization =
      previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
        : null;
    const totalMemoryBytes = NodeOS.totalmem();
    // On Windows libuv returns GlobalMemoryStatusEx.ullAvailPhys, including standby memory.
    let availableMemoryBytes = NodeOS.freemem();
    let memory: NonNullable<HostResourcesSnapshot["memory"]> = {
      pressure: null,
      compressedBytes: null,
      wiredBytes: null,
      swapUsedBytes: null,
      swapTotalBytes: null,
      swapReadBytesPerSecond: null,
      swapWriteBytesPerSecond: null,
    };
    if (platform === "linux") {
      const meminfo = yield* fs
        .readFileString("/proc/meminfo")
        .pipe(Effect.orElseSucceed(() => ""));
      const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (available) availableMemoryBytes = Number(available) * 1024;
      const swapTotal = /^SwapTotal:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      const swapFree = /^SwapFree:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      memory = {
        ...memory,
        swapTotalBytes: swapTotal ? nonNegativeInteger(Number(swapTotal) * 1024) : null,
        swapUsedBytes:
          swapTotal && swapFree
            ? nonNegativeInteger((Number(swapTotal) - Number(swapFree)) * 1024)
            : null,
      };
    } else if (platform === "darwin") {
      const [output, pressure, swapUsage] = yield* Effect.all(
        [
          readCommand("/usr/bin/vm_stat", []),
          readCommand("/usr/sbin/sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]),
          readCommand("/usr/sbin/sysctl", ["-n", "vm.swapusage"]),
        ],
        { concurrency: "unbounded" },
      );
      const vm = parseDarwinVmStat(output);
      availableMemoryBytes = vm.availableBytes ?? availableMemoryBytes;
      const currentSwap = { ...vm, timeNanos: yield* Clock.monotonicTimeNanos };
      memory = {
        pressure: parseDarwinMemoryPressure(pressure),
        compressedBytes: vm.compressedBytes,
        wiredBytes: vm.wiredBytes,
        ...parseDarwinSwapUsage(swapUsage),
        ...calculateSwapRates(currentSwap, previousSwap),
      };
      previousSwap = currentSwap;
    }
    return {
      sampledAt: DateTime.toEpochMillis(yield* DateTime.now),
      cpuUtilization,
      cpuCount: cpu.count,
      availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
      totalMemoryBytes,
      memory,
    };
  });

  // One server-lifetime cache deduplicates simultaneous requests from all sockets.
  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_key: "host") => sample(),
    timeToLive: "5 seconds",
  });
  return HostResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(HostResources, make());
