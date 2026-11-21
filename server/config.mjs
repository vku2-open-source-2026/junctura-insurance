// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "./env.mjs";

const DEFAULT_PORT = 5185;
const DEFAULT_SLA_DAYS = 30;

/**
 * Configuration comes from the environment. For the local demo, the credentials file
 * that `npm run demo:setup` (junctura-health) wrote for this app is read too; real
 * environment variables win over the file. Nothing here is ever sent to a browser
 * except the public issuer and the public web client id.
 */
export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const healthDir = resolve(cwd, env.JUNCTURA_HEALTH_DIR ?? "../junctura-health");
  const envFile = resolve(cwd, env.JUNCTURA_INSURANCE_ENV ?? `${healthDir}/.junctura/demo/junctura-insurance.env`);
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const get = key => env[key] ?? fromFile[key];

  const issuer = get("JUNCTURA_ISSUER");
  const webClientId = get("JUNCTURA_WEB_CLIENT_ID");
  if (!issuer || !webClientId) {
    throw new Error("JUNCTURA_ISSUER and JUNCTURA_WEB_CLIENT_ID are required. Run `npm run demo:setup` in junctura-health, or set them in the environment.");
  }
  const port = Number(get("PORT") ?? get("WEB_PORT") ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError("PORT must be a valid port number");
  const slaDays = Number(get("INSURANCE_SLA_DAYS") ?? DEFAULT_SLA_DAYS);
  if (!Number.isInteger(slaDays) || slaDays < 1 || slaDays > 365) throw new RangeError("INSURANCE_SLA_DAYS must be a whole number of days from 1 to 365");
  const juncturaUrl = get("JUNCTURA_URL");
  const juncturaClientId = get("JUNCTURA_APP_CLIENT_ID");
  const juncturaClientSecret = get("JUNCTURA_APP_CLIENT_SECRET");
  const junctura = juncturaUrl && juncturaClientId && juncturaClientSecret
    ? Object.freeze({ url: juncturaUrl, clientId: juncturaClientId, clientSecret: juncturaClientSecret })
    : null;
  return Object.freeze({
    issuer: issuer.replace(/\/+$/, ""),
    webClientId,
    port,
    host: get("HOST") ?? "127.0.0.1",
    healthDir,
    slaDays,
    staticDir: resolve(cwd, get("INSURANCE_STATIC_DIR") ?? "web/dist"),
    junctura,
  });
}
