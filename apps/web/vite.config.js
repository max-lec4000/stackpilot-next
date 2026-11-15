import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { inventoryMiddleware } from "../server/middleware.js";
export default defineConfig({
  define: {
    __STACKPILOT_VERSION__: JSON.stringify(
      JSON.parse(
        readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
      ).version,
    ),
  },
  plugins: [
    {
      name: "stackpilot-local-api",
      configureServer(server) {
        server.middlewares.use(inventoryMiddleware());
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    strictPort: true,
    allowedHosts: ["stackpilot.localhost", "localhost"],
    fs: {
      strict: true,
      allow: [
        fileURLToPath(new URL("./", import.meta.url)),
        fileURLToPath(new URL("../../packages/", import.meta.url)),
        fileURLToPath(new URL("../../node_modules/", import.meta.url)),
      ],
      deny: [
        "**/.stackpilot/**",
        "**/dev-private/**",
        "**/reports/**",
        "**/*.key",
        "**/.env",
        "**/.env.*",
        "**/*.{crt,pem}",
        "**/.git/**",
        "**/.vite-temp/**",
      ],
    },
  },
});
