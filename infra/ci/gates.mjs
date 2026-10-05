import { execFile } from "node:child_process";
import { promisify, stripVTControlCharacters } from "node:util";
import { projectScan, scannerStages } from "./scan-evidence.mjs";

const execute = promisify(execFile);

/** No original error, command, environment, stdout or stderr can enter CI diagnostics. */
export async function runGate(stage, command, args, options = {}) {
  if (!/^[a-z][a-z0-9-]{0,60}$/.test(stage)) throw new Error("CI_GATE_INVALID_STAGE");
  try {
    const result = await execute(command, args, {
      timeout: 600000,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
    return result.stdout;
  } catch {
    throw new Error(`CI_GATE_FAILED:${stage}`);
  }
}

export async function runSequence(gates) {
  const results = [];
  for (const gate of gates) {
    const started = Date.now();
    const output = await runGate(gate.stage, gate.command, gate.args, gate.options);
    // Retain only counts; assertions, private browser views and SQL errors are discarded.
    const text = stripVTControlCharacters(output);
    let scan;
    let smoke;
    if (gate.stage === "application-image-smoke") {
      try {
        const report = JSON.parse(output);
        if (
          report.schemaVersion !== 1 ||
          report.purpose !== "disposable-packaging-smoke" ||
          report.passed !== true ||
          report.productionReady !== false ||
          !Number.isSafeInteger(report.checks) ||
          report.checks < 1 ||
          report.browserCases !== 2
        )
          throw new Error();
        smoke = { runtimeChecks: report.checks, browserCases: report.browserCases };
      } catch {
        throw new Error(`CI_GATE_FAILED:${gate.stage}`);
      }
    }
    if (scannerStages.has(gate.stage)) {
      try {
        scan = projectScan(JSON.parse(output), gate.stage);
      } catch {
        throw new Error(`CI_GATE_FAILED:${gate.stage}`);
      }
      console.info(JSON.stringify({ stage: gate.stage, scan }));
    }
    results.push({
      stage: gate.stage,
      passed: true,
      ...(scan ? { scan } : {}),
      durationMs: Date.now() - started,
      tests: [...text.matchAll(/\bTests\s+(\d+) passed/g)].reduce(
        (n, match) => n + Number(match[1]),
        0,
      ),
      browserCases: [...text.matchAll(/(?:^|\n)\s*(\d+) passed \(/g)].reduce(
        (n, match) => n + Number(match[1]),
        0,
      ),
      ...smoke,
    });
    console.info(`CI gate passed: ${gate.stage}`);
  }
  return results;
}
