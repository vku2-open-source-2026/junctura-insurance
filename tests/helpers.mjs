// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { createApp } from "../server/app.mjs";
import { buildInsuranceData } from "../server/data.mjs";
import { createCallLog, createChecks, createDecisions, createSettlements } from "../server/event-log.mjs";
import { createVerifier } from "../server/jwt.mjs";

export const ISSUER = "https://id.example.test/identity/realms/junctura";
export const CLIENT = "health-insurance-web";
export const ASSESSOR = "giamdinh.baohiem";

export function makeSigner(kid = "k1") {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const sign = (claims = {}, { header = {}, key = privateKey } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const body = { iss: ISSUER, azp: CLIENT, exp: now + 300, preferred_username: ASSESSOR, ...claims };
    const head = encode({ alg: "RS256", typ: "JWT", kid, ...header });
    const input = `${head}.${encode(body)}`;
    return `${input}.${createSign("RSA-SHA256").update(input).sign(key).toString("base64url")}`;
  };
  return { jwk, sign, privateKey };
}

export const SUBJECTS = {
  a: "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d",
  b: "1b2c3d4e-5f6a-4b7c-8d8e-9f0a1b2c3d4e",
  c: "2c3d4e5f-6a7b-4c8d-9e9f-0a1b2c3d4e5f",
};

export const fixture = {
  facility: "Bệnh viện Thử nghiệm",
  accounts: {
    users: [
      { subject: "u-1", username: ASSESSOR, displayName: "Giám định viên Đỗ Quốc Hùng", role: "claims-assessor", app: "junctura-insurance" },
      { subject: "u-2", username: "nhanvien.khac", displayName: "Nhân viên khác", role: "clerk", app: "junctura-insurance" },
      { subject: "u-3", username: "bacsi.benhvien", displayName: "BS. Phạm Minh Quang", role: "physician", app: "junctura-hospital" },
    ],
  },
  requests: {
    claimRequests: [
      { claimId: "HS-2026-00001", subject: SUBJECTS.a, requestedAmountVnd: 2450000, submittedAt: "2026-10-20T05:00:00.000Z" },
      { claimId: "HS-2026-00002", subject: SUBJECTS.b, requestedAmountVnd: 3018000, submittedAt: "2026-09-02T05:00:00.000Z" },
      { claimId: "HS-2026-00003", subject: SUBJECTS.c, requestedAmountVnd: 9890000, submittedAt: "2026-09-28T05:00:00.000Z" },
    ],
  },
};

/** An in-memory stand-in for the Junctura record store. */
export function memoryClient({ createError } = {}) {
  const records = [];
  return {
    records,
    async createRecord(collection, data) {
      if (createError) throw createError;
      const record = { id: `r-${records.length + 1}`, collection, data: { ...data } };
      records.push(record);
      return record;
    },
    async request(path) {
      const collection = path.split("/").at(-1);
      const items = records.filter(record => record.collection === collection).map(record => ({ id: record.id, data: record.data }));
      return { ok: true, json: async () => ({ items }) };
    },
  };
}

export function memoryStores(options) {
  const client = memoryClient(options);
  return { client, callLog: createCallLog({ client }), checks: createChecks({ client }), decisions: createDecisions({ client }), settlements: createSettlements({ client }) };
}

/** Starts the real app on an ephemeral port with a fake identity provider key set. */
export async function startApp({ staticDir = "/nonexistent", capabilities, stores = memoryStores(), data = buildInsuranceData(fixture), clock, slaDays = 30 } = {}) {
  const signer = makeSigner();
  const config = { issuer: ISSUER, webClientId: CLIENT, staticDir, slaDays };
  const verifier = createVerifier({ issuer: ISSUER, clientId: CLIENT, getJson: async () => ({ keys: [signer.jwk] }) });
  const server = createServer(createApp({ config, data, verifier, capabilities, callLog: stores.callLog, checks: stores.checks, decisions: stores.decisions, settlements: stores.settlements, ...(clock && { clock }) }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = signer.sign();
  const call = async (path, { method = "GET", body, headers = {}, auth = token } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(auth && { authorization: `Bearer ${auth}` }), ...(body !== undefined && { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: response.status, json, text, headers: response.headers };
  };
  return { signer, base, call, stores, close: () => new Promise(resolve => server.close(resolve)) };
}

/** A capability caller that answers claim-verify from a table of fixed answers. */
export function fakeCapabilities(answer) {
  const calls = [];
  return {
    calls,
    async call(slug, input, context) {
      calls.push({ slug, input, context });
      return typeof answer === "function" ? answer(input, context) : answer;
    },
  };
}
export const answerOk = matches => ({ status: "ok", output: { matches, checkedAt: "2026-11-20T08:00:00.000Z" }, receivedAt: "2026-11-20T08:00:01.000Z" });
