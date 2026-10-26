import { startAdmin } from "./admin-runtime.js";
try {
  const admin = await startAdmin(process.env);
  if (admin) {
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      const deadline = setTimeout(() => process.exit(1), 10000);
      deadline.unref();
      void admin.close().then(
        () => clearTimeout(deadline),
        () => {
          process.exitCode = 1;
        },
      );
    };
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  }
} catch {
  // No framework/raw exception output may contain credentials or SQL.
  process.stderr.write("ADMIN_STARTUP_FAILED\n");
  process.exitCode = 1;
}
