import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("rejects an invalid CLI workload before services and suppresses private input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-capacity-invalid-"));
  const canary = "PRIVATE_CAPACITY_INPUT_CANARY";
  try {
    const input = join(directory, "invalid.json");
    await writeFile(
      input,
      JSON.stringify({ peakCcu: canary, targetUrl: `https://${canary}.invalid` }),
    );
    let failure;
    try {
      await promisify(execFile)(
        process.execPath,
        [
          new URL("../scripts/test-capacity-local.mjs", import.meta.url).pathname,
          "--profile",
          input,
        ],
        { timeout: 10000 },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure?.code).toBe(1);
    const diagnostics = `${failure.stdout}${failure.stderr}`;
    expect(diagnostics).toContain("CAPACITY_LOCAL_FAILED at profile (CAPACITY_PROFILE_INVALID)");
    expect(diagnostics.includes(canary)).toBe(false);
    expect(diagnostics.includes("Capacity evidence:")).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects an oversized connection probe before build or service allocation", async () => {
  let failure;
  try {
    await promisify(execFile)(
      process.execPath,
      [
        new URL("../scripts/test-capacity-local.mjs", import.meta.url).pathname,
        "--connections",
        "2001",
      ],
      { timeout: 10000 },
    );
  } catch (error) {
    failure = error;
  }
  expect(failure?.code).toBe(1);
  expect(failure.stderr).toContain("CAPACITY_LOCAL_FAILED at profile (CAPACITY_FIXTURE_LIMIT)");
  expect(failure.stdout.includes("Capacity evidence:")).toBe(false);
});

it("keeps focused diagnostic profile validation and rejects incompatible CLI modes before allocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hambazi-capacity-invalid-"));
  const canary = "PRIVATE_DIAGNOSTIC_INPUT_CANARY";
  try {
    const input = join(directory, "invalid.json");
    await writeFile(input, JSON.stringify({ peakCcu: canary }));
    for (const args of [
      ["--profile", input, "--normal-and-stress"],
      ["--profile", input, "--stress-only"],
      ["--smoke", "--normal-and-stress"],
      ["--connections", "2000", "--normal-and-stress"],
      ["--smoke", "--stress-only"],
    ]) {
      let failure;
      try {
        await promisify(execFile)(
          process.execPath,
          [new URL("../scripts/test-capacity-local.mjs", import.meta.url).pathname, ...args],
          { timeout: 10000 },
        );
      } catch (error) {
        failure = error;
      }
      expect(failure?.code).toBe(1);
      const diagnostics = `${failure.stdout}${failure.stderr}`;
      expect(diagnostics).toContain("CAPACITY_LOCAL_FAILED at profile (CAPACITY_PROFILE_INVALID)");
      expect(diagnostics.includes(canary)).toBe(false);
      expect(diagnostics.includes("Capacity evidence:")).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
