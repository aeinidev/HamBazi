// The operational listener stays inside the container's loopback namespace.
const role = process.env.HAMBAZI_SERVICE;
try {
  if (!["api", "bot", "worker", "web"].includes(role)) throw new Error();
  const port = process.env[`${role.toUpperCase()}_HEALTH_PORT`];
  if (!/^\d{1,5}$/.test(port ?? "") || Number(port) < 1 || Number(port) > 65535) throw new Error();
  const response = await fetch(`http://127.0.0.1:${port}/v1/health/ready`, {
    signal: AbortSignal.timeout(2000),
    redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || body.schemaVersion !== 1 || !["READY", "DEGRADED"].includes(body.status))
    throw new Error();
} catch {
  // No request, response, environment or error content enters Docker health logs.
  process.exitCode = 1;
}
