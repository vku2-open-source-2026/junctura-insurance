// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { JuncturaError } from "@junctura/server-client";
import { getContract } from "@junctura/health-contracts";
import { createCapabilityCaller } from "../server/junctura.mjs";

const PROVIDER = "00000000-0000-0000-0000-000000000001";
const context = { purpose: "claim_review", dataSubject: "member-1" };
const input = { claimId: "HS-2026-00001", amountVnd: 2450000 };
const output = { matches: true, checkedAt: "2026-11-20T08:00:00.000Z" };

const reference = (slug = "claim-verify") => ({
  state: "published",
  version: getContract(slug).version,
  digest: `sha256:${slug}`,
  manifest: { capabilityId: `urn:junctura:capability:${PROVIDER}:${slug}` },
});

function fakeClient({ pages = () => ({ items: [reference()], nextCursor: null }), execute, wait } = {}) {
  const calls = { discover: [], execute: [], wait: [] };
  return {
    calls,
    async discover(query = {}) { calls.discover.push(query); return pages(query); },
    async execute(target, value, key, executionContext) {
      calls.execute.push({ target, value, context: executionContext });
      return execute ? execute(calls.execute.length) : { executionId: "exec-1", state: "accepted" };
    },
    async waitForExecution(executionId, options) {
      calls.wait.push({ executionId, options });
      return wait ? wait(calls.wait.length) : { executionId, state: "succeeded", output };
    },
  };
}

test("claim-verify is called for the member with the claim review purpose and returns the yes or no", async () => {
  const client = fakeClient();
  const result = await createCapabilityCaller({ client, now: () => new Date("2026-11-20T08:00:01.000Z") }).call("claim-verify", input, context);
  assert.deepEqual(result, { status: "ok", output, receivedAt: "2026-11-20T08:00:01.000Z" });
  assert.deepEqual(client.calls.execute[0].value, input);
  assert.deepEqual(client.calls.execute[0].context, context);
  assert.equal(client.calls.execute[0].target.capability.capabilityId, `urn:junctura:capability:${PROVIDER}:claim-verify`);
});

test("a purpose or a missing member that the contract does not allow is refused before any call", async () => {
  const client = fakeClient();
  const caller = createCapabilityCaller({ client });
  assert.equal((await caller.call("claim-verify", input, { purpose: "treatment", dataSubject: "member-1" })).status, "not-authorized");
  assert.equal((await caller.call("claim-verify", input, { purpose: "claim_review" })).status, "not-authorized");
  assert.equal(client.calls.execute.length, 0);
});

test("an answer that is not the contract's yes or no is rejected", async () => {
  const client = fakeClient({ wait: () => ({ executionId: "e", state: "succeeded", output: { matches: "yes", diagnosis: "x" } }) });
  assert.deepEqual(await createCapabilityCaller({ client }).call("claim-verify", input, context), { status: "invalid-output" });
});

test("no consent from the member is reported as no-consent", async () => {
  const client = fakeClient({ execute: () => { throw new JuncturaError(403, "consent_required"); } });
  assert.deepEqual(await createCapabilityCaller({ client }).call("claim-verify", input, context), { status: "no-consent" });
});

test("a hospital that does not provide claim-verify yet is reported as unavailable without executing", async () => {
  const client = fakeClient({ pages: () => ({ items: [], nextCursor: null }) });
  assert.deepEqual(await createCapabilityCaller({ client }).call("claim-verify", input, context), { status: "unavailable", reason: "capability_not_found" });
  assert.equal(client.calls.execute.length, 0);
});

test("a disconnected gateway is unavailable, and a failed execution is failed", async () => {
  const down = fakeClient({ execute: () => { throw new JuncturaError(0, "gateway_unavailable"); } });
  assert.deepEqual(await createCapabilityCaller({ client: down }).call("claim-verify", input, context), { status: "unavailable", reason: "gateway_unavailable" });
  const failed = fakeClient({ wait: () => ({ executionId: "e", state: "failed" }) });
  assert.deepEqual(await createCapabilityCaller({ client: failed }).call("claim-verify", input, context), { status: "failed", reason: "failed" });
});

test("the capability reference is found once and reused", async () => {
  const client = fakeClient();
  const caller = createCapabilityCaller({ client });
  await caller.call("claim-verify", input, context);
  await caller.call("claim-verify", input, context);
  assert.equal(client.calls.discover.length, 1);
});
