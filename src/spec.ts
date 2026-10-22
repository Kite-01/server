// Prints the OpenAPI spec without a database or real secrets: building the
// app only reads the environment, it never connects.
const placeholders = {
  KITE_PUBLIC_BASE_URL: "http://localhost:3000",
  KITE_PG_DB_URL: "postgres://kite:kite@localhost:5432/kite",
  KITE_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  KITE_OPERATOR_MNEMONIC:
    "test test test test test test test test test test test junk",
  KITE_ROOT_KEY: "spec-placeholder-root-key",
};

for (const [name, value] of Object.entries(placeholders)) {
  process.env[name] ??= value;
}

process.env.KITE_ENABLE_OPENAPI_UI_SPECS = "true";

const main = async () => {
  const { createApp } = await import("./api/app.js");
  const response = await createApp({ client: false }).handle(
    new Request("http://localhost/openapi/json"),
  );

  const spec = `${JSON.stringify(await response.json(), null, 2)}\n`;
  const out = process.argv[2];

  if (out) await Bun.write(out, spec);
  else process.stdout.write(spec);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
