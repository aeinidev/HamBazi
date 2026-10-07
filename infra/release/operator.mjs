import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { privateFile } from "./prepare.mjs";
import { runGate } from "../ci/gates.mjs";
import { operatorProfile, projectOperatorLogs, projectOperatorMetrics } from "./monitoring.mjs";

/** Read-only existing-container inspection. Never starts a service or reads its role file. */
export async function inspectOperator(directory, role, action, project = "hambazi-preparation") {
  if (
    !["api", "bot", "worker", "web"].includes(role) ||
    !["logs", "live", "ready", "metrics"].includes(action) ||
    (role === "web" && action === "metrics") ||
    !/^[a-z0-9][a-z0-9_-]{0,100}$/.test(project)
  )
    throw new Error("OPERATOR_INSPECTION_INVALID");
  const evidence = JSON.parse(await privateFile(join(directory, "preparation.json")));
  const bytes = await privateFile(join(directory, "compose.yaml"));
  if (
    evidence.operatorMonitoring?.profile !== operatorProfile ||
    evidence.composeSha256 !== createHash("sha256").update(bytes).digest("hex")
  )
    throw new Error("OPERATOR_INSPECTION_INVALID");
  const definition = parse(bytes.toString(), { merge: true });
  const service = definition.services?.[role];
  if (!service || service.ports || service.network_mode || service.logging?.driver !== "local")
    throw new Error("OPERATOR_INSPECTION_INVALID");
  const container = (
    await runGate("operator-container", "docker", [
      "compose",
      "--env-file",
      "/dev/null",
      "--project-name",
      project,
      "--file",
      join(directory, "compose.yaml"),
      "ps",
      "--quiet",
      role,
    ])
  ).trim();
  if (!/^[a-f0-9]{64}$/.test(container)) throw new Error("OPERATOR_CONTAINER_UNAVAILABLE");
  const state = JSON.parse(
    await runGate("operator-identity", "docker", [
      "inspect",
      "--format",
      '{"image":{{json .Config.Image}},"user":{{json .Config.User}},"ports":{{json .HostConfig.PortBindings}},"logging":{{json .HostConfig.LogConfig.Type}}}',
      container,
    ]),
  );
  if (
    state.image !== service.image ||
    state.user !== "1000:1000" ||
    Object.keys(state.ports ?? {}).length ||
    state.logging !== "local"
  )
    throw new Error("OPERATOR_INSPECTION_INVALID");
  if (action === "logs") {
    const text = await runGate("operator-logs", "docker", ["logs", "--tail", "200", container]);
    return { checkedAt: new Date().toISOString(), role, action, ...projectOperatorLogs(text) };
  }
  const endpoint = action === "metrics" ? "/v1/metrics" : `/v1/health/${action}`;
  const code = `try {
    const port=process.env[${JSON.stringify(`${role.toUpperCase()}_HEALTH_PORT`)}];
    if(!/^\\d{1,5}$/.test(port??'')||+port<1||+port>65535)throw new Error();
    const response=await fetch('http://127.0.0.1:'+port+${JSON.stringify(endpoint)},{signal:AbortSignal.timeout(3000),redirect:'error'});
    const body=await response.text(); if(Buffer.byteLength(body)>65536)throw new Error();
    console.log(JSON.stringify({status:response.status,body}));
  } catch {process.exitCode=1;}`;
  const result = JSON.parse(
    await runGate("operator-loopback", "docker", [
      "exec",
      container,
      "node",
      "--input-type=module",
      "-e",
      code,
    ]),
  );
  if (action === "metrics") {
    if (result.status !== 200) throw new Error("OPERATOR_METRICS_UNAVAILABLE");
    return {
      checkedAt: new Date().toISOString(),
      role,
      action,
      httpStatus: result.status,
      metrics: projectOperatorMetrics(result.body, role),
    };
  }
  const body = JSON.parse(result.body);
  if (
    ![200, 503].includes(result.status) ||
    body.schemaVersion !== 1 ||
    !["LIVE", "READY", "DEGRADED", "NOT_READY"].includes(body.status) ||
    (action === "live" ? body.status !== "LIVE" : body.status === "LIVE") ||
    (body.status === "NOT_READY" ? result.status !== 503 : result.status !== 200)
  )
    throw new Error("OPERATOR_HEALTH_INVALID");
  return {
    checkedAt: new Date().toISOString(),
    role,
    action,
    httpStatus: result.status,
    schemaVersion: 1,
    status: body.status,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (![5, 6].includes(process.argv.length)) throw new Error();
    console.info(
      JSON.stringify(
        await inspectOperator(
          resolve(process.argv[2]),
          process.argv[3],
          process.argv[4],
          process.argv[5],
        ),
      ),
    );
  } catch {
    console.error("OPERATOR_INSPECTION_FAILED");
    process.exitCode = 1;
  }
}
