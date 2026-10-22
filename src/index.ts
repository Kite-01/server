import { Scheduler } from "./shared/scheduler";
import { createApp } from "./api/app";
import { env } from "./shared/env";
import { sql } from "./db";

const main = async () => {
  const scheduler = await Scheduler.getInstance();

  const port = env.KITE_PORT;
  let stopServer: (() => void) | undefined;

  const app = createApp();

  await app.modules;

  app.listen(port, (server) => {
    stopServer = () => server.stop();
  });

  console.log(`Kite is listening on port: ${port}`);

  if (env.KITE_ENABLE_DASHBOARD) {
    console.log(`Kite dashboard is available @: ${env.KITE_PUBLIC_BASE_URL}`);
  } else {
    console.log(
      `Kite checkout is available @: ${env.KITE_PUBLIC_BASE_URL}/pay/<payment link id>`,
    );
  }

  if (env.KITE_ENABLE_OPENAPI_UI_SPECS) {
    console.log(
      `Kite openapi specs is available @: ${env.KITE_PUBLIC_BASE_URL}/openapi`,
    );
  }

  const shutdown = async () => {
    stopServer?.();

    await scheduler.stop();
    await sql.end({ timeout: 5 });

    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
