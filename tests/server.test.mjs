// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { SUBJECTS, answerOk, fakeCapabilities, memoryStores, startApp } from "./helpers.mjs";

const CLAIM = "HS-2026-00001";

async function withApp(options, run) {
  const app = await startApp(options);
  try { await run(app); } finally { await app.close(); }
}

test("the public config exposes only the issuer, the web client and the facility", async () => {
  await withApp({}, async ({ call }) => {
    const { status, json } = await call("/api/config", { auth: null });
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(json).sort(), ["clientId", "facility", "issuer"]);
  });
});

test("sign-in is required, and only this application's assessors get in", async () => {
  await withApp({}, async ({ call, signer }) => {
    assert.equal((await call("/api/claims", { auth: null })).status, 401);
    assert.equal((await call("/api/claims", { auth: "not-a-token" })).status, 401);
    assert.equal((await call("/api/claims", { auth: signer.sign({ preferred_username: "bacsi.benhvien" }) })).status, 403);
    assert.equal((await call("/api/claims", { auth: signer.sign({ preferred_username: "nobody" }) })).status, 403);
    assert.equal((await call("/api/claims", { auth: signer.sign({ preferred_username: "nhanvien.khac" }) })).status, 403);
    assert.equal((await call("/api/claims", { auth: signer.sign({ azp: "another-client" }) })).status, 401);
    const me = await call("/api/me", { auth: signer.sign({ preferred_username: "nhanvien.khac" }) });
    assert.equal(me.status, 200);
    assert.equal(me.json.role, "clerk");
  });
});

test("the queue lists the claims newest first and never exposes the member identifier", async () => {
  await withApp({}, async ({ call }) => {
    const { status, json, text } = await call("/api/claims");
    assert.equal(status, 200);
    assert.deepEqual(json.items.map(item => item.claimId), ["HS-2026-00001", "HS-2026-00003", "HS-2026-00002"]);
    assert.equal(json.counts.new, 3);
    assert.equal(json.open, 3);
    assert.equal(json.facility, "Bệnh viện Thử nghiệm");
    for (const subject of Object.values(SUBJECTS)) assert.ok(!text.includes(subject), "member identifier leaked");
    assert.equal(json.items[0].memberRef, "…1B2C3D".replace("1B2C3D", SUBJECTS.a.replaceAll("-", "").slice(-6).toUpperCase()));
  });
});

test("checking a claim asks Junctura for the member with purpose claim_review and records only the yes or no", async () => {
  const capabilities = fakeCapabilities(answerOk(true));
  await withApp({ capabilities }, async ({ call, stores }) => {
    const { status, json } = await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
    assert.equal(status, 200);
    assert.deepEqual(json.result, { status: "ok", matches: true, checkedAt: "2026-11-20T08:00:00.000Z" });
    assert.equal(json.saved, true);
    assert.equal(json.claim.status, "match");
    assert.deepEqual(capabilities.calls, [{
      slug: "claim-verify",
      input: { claimId: CLAIM, amountVnd: 2450000 },
      context: { purpose: "claim_review", dataSubject: SUBJECTS.a },
    }]);
    const log = await stores.callLog.list();
    assert.equal(log.length, 1);
    assert.deepEqual({ capability: log[0].capability, purpose: log[0].purpose, outcome: log[0].outcome, claimId: log[0].claimId }, { capability: "claim-verify", purpose: "claim_review", outcome: "ok", claimId: CLAIM });
    assert.equal(stores.client.records.some(record => JSON.stringify(record.data).includes(SUBJECTS.a)), false, "the member identifier must not be stored");
  });
});

test("a claim that does not match is shown as a mismatch", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(false)) }, async ({ call }) => {
    const { json } = await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
    assert.equal(json.result.matches, false);
    assert.equal(json.claim.status, "mismatch");
    assert.equal(json.claim.check.matches, false);
  });
});

test("a refused call is reported and leaves the claim unchecked", async () => {
  for (const status of ["no-consent", "unavailable", "not-authorized", "failed", "invalid-output"]) {
    await withApp({ capabilities: fakeCapabilities({ status, reason: "x" }) }, async ({ call, stores }) => {
      const { status: http, json } = await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
      assert.equal(http, 200);
      assert.deepEqual(json.result, { status });
      assert.equal(json.claim.status, "new");
      assert.equal(json.claim.check, null);
      assert.equal((await stores.checks.list()).length, 0);
      assert.equal((await stores.callLog.list())[0].outcome, status);
    });
  }
});

test("when the result cannot be saved the answer still comes back, marked as not saved", async () => {
  const base = memoryStores();
  const stores = { ...base, checks: { ...base.checks, add: async () => { throw Object.assign(new Error("store-unavailable"), { status: 503, code: "store-unavailable" }); } } };
  const originalError = console.error;
  console.error = () => {};
  try {
    await withApp({ capabilities: fakeCapabilities(answerOk(true)), stores }, async ({ call }) => {
      const { status, json } = await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
      assert.equal(status, 200);
      assert.equal(json.saved, false);
      assert.equal(json.result.matches, true);
    });
  } finally { console.error = originalError; }
});

test("checking needs Junctura to be configured and a known claim", async () => {
  await withApp({}, async ({ call }) => {
    assert.equal((await call(`/api/claims/${CLAIM}/verify`, { method: "POST" })).status, 503);
  });
  await withApp({ capabilities: fakeCapabilities(answerOk(true)) }, async ({ call }) => {
    assert.equal((await call("/api/claims/HS-UNKNOWN/verify", { method: "POST" })).status, 404);
    assert.equal((await call("/api/claims/HS-2026-00001/verify")).status, 405);
    assert.equal((await call("/api/claims/bad%20id/verify", { method: "POST" })).status, 404);
  });
});

test("a claim cannot be accepted before a check found that it matches", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(false)) }, async ({ call }) => {
    const body = { kind: "accepted", reason: "Hồ sơ đầy đủ" };
    assert.equal((await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body })).status, 409);
    assert.equal((await call(`/api/claims/${CLAIM}/verify`, { method: "POST" })).status, 200);
    const refused = await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, "not-verified");
  });
});

test("accepting a matching claim is final and keeps the reason and who decided", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(true)) }, async ({ call }) => {
    await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
    const accepted = await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: { kind: "accepted", reason: "  Số tiền khớp hồ sơ  " } });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.json.claim.status, "accepted");
    assert.equal(accepted.json.claim.decision.reason, "Số tiền khớp hồ sơ");
    assert.equal(accepted.json.claim.decision.assessorName, "Giám định viên Đỗ Quốc Hùng");
    const again = await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: { kind: "rejected", reason: "Đổi ý" } });
    assert.equal(again.status, 409);
    assert.equal(again.json.error, "already-decided");
    const detail = await call(`/api/claims/${CLAIM}`);
    assert.deepEqual(detail.json.history.map(entry => entry.type), ["decision", "check"]);
    const queue = await call("/api/claims");
    assert.equal(queue.json.open, 2);
  });
});

test("a claim can be rejected, or an explanation requested, without a check", async () => {
  await withApp({}, async ({ call }) => {
    const explain = await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: { kind: "explain", reason: "Cần giải trình số tiền" } });
    assert.equal(explain.status, 201);
    assert.equal(explain.json.claim.status, "explain");
    const rejected = await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: { kind: "rejected", reason: "Không giải trình được" } });
    assert.equal(rejected.status, 201);
    assert.equal(rejected.json.claim.status, "rejected");
  });
});

test("a decision needs a valid kind and a reason of 3 to 300 characters", async () => {
  await withApp({}, async ({ call }) => {
    const post = body => call(`/api/claims/${CLAIM}/decision`, { method: "POST", body });
    assert.equal((await post({ kind: "rejected" })).status, 400);
    assert.equal((await post({ kind: "rejected", reason: "ab" })).status, 400);
    assert.equal((await post({ kind: "rejected", reason: "   " })).status, 400);
    assert.equal((await post({ kind: "rejected", reason: "x".repeat(301) })).status, 400);
    assert.equal((await post({ kind: "deleted", reason: "Lý do hợp lệ" })).status, 400);
    assert.equal((await post([])).status, 400);
    assert.equal((await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: "{}", headers: { "content-type": "text/plain" } })).status, 415);
    assert.equal((await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: { kind: "rejected", reason: "x".repeat(5000) } })).status, 413);
    assert.equal((await post({ kind: "rejected", reason: "Đủ ba" })).status, 201);
  });
});

test("the call log lists the checks newest first without any member identifier", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(true)) }, async ({ call }) => {
    await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
    await call("/api/claims/HS-2026-00002/verify", { method: "POST" });
    const { status, json, text } = await call("/api/call-log");
    assert.equal(status, 200);
    assert.equal(json.items.length, 2);
    assert.ok(Date.parse(json.items[0].at) >= Date.parse(json.items[1].at));
    for (const subject of Object.values(SUBJECTS)) assert.ok(!text.includes(subject));
  });
});

test("the report counts checked claims, mismatches and the money accepted and rejected", async () => {
  await withApp({ capabilities: fakeCapabilities(input => answerOk(input.claimId !== "HS-2026-00002")) }, async ({ call, base, signer }) => {
    assert.equal((await call("/api/report")).json.total.mismatchRate, null);
    for (const id of ["HS-2026-00001", "HS-2026-00002"]) await call(`/api/claims/${id}/verify`, { method: "POST" });
    await call("/api/claims/HS-2026-00001/decision", { method: "POST", body: { kind: "accepted", reason: "Khớp hồ sơ" } });
    await call("/api/claims/HS-2026-00002/decision", { method: "POST", body: { kind: "rejected", reason: "Lệch số tiền" } });
    const { json } = await call("/api/report");
    assert.equal(json.total.claims, 3);
    assert.equal(json.total.checked, 2);
    assert.equal(json.total.mismatches, 1);
    assert.equal(json.total.mismatchRate, 50);
    assert.equal(json.total.acceptedVnd, 2450000);
    assert.equal(json.total.rejectedVnd, 3018000);
    assert.equal(json.total.openVnd, 9890000);
    assert.deepEqual(json.months.map(row => row.month), ["2026-09", "2026-10"]);
    const csv = await call("/api/report.csv");
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    // Read as bytes: fetch's text() would swallow the byte order mark that makes Excel read UTF-8.
    const bytes = Buffer.from(await (await fetch(`${base}/api/report.csv`, { headers: { authorization: `Bearer ${signer.sign()}` } })).arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(csv.text.startsWith("Tháng,"));
    assert.ok(csv.text.includes("2026-10,1,1,0,0,2450000,0"));
  });
});

test("without the Junctura record store the data routes answer 503 instead of an empty list", async () => {
  const stores = { callLog: null, checks: null, decisions: null };
  await withApp({ stores }, async ({ call }) => {
    for (const path of ["/api/claims", "/api/call-log", "/api/report", `/api/claims/${CLAIM}`]) assert.equal((await call(path)).status, 503, path);
  });
});

test("a store failure answers 503 and logs only a code", async () => {
  const base = memoryStores();
  const stores = { ...base, checks: { ...base.checks, list: async () => { throw Object.assign(new Error("store-unavailable"), { status: 503, code: "store-unavailable" }); } } };
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    await withApp({ stores }, async ({ call }) => {
      const { status, json } = await call("/api/claims");
      assert.equal(status, 503);
      assert.equal(json.error, "store-unavailable");
    });
  } finally { console.error = originalError; }
  assert.deepEqual(logged, ["store-unavailable"]);
});

test("responses carry security headers, API answers are not cached, and wrong methods are refused", async () => {
  await withApp({}, async ({ call }) => {
    const queue = await call("/api/claims");
    assert.equal(queue.headers.get("x-frame-options"), "DENY");
    assert.equal(queue.headers.get("cache-control"), "no-store");
    assert.match(queue.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal((await call("/api/claims", { method: "POST", body: {} })).status, 405);
    assert.equal((await call("/api/nothing")).status, 404);
    assert.equal((await call("/healthz", { auth: null })).status, 200);
  });
});

const accept = (call, claimId, extra = {}) => call(`/api/claims/${claimId}/decision`, { method: "POST", body: { kind: "accepted", reason: "Khớp hồ sơ", ...extra } });

test("an acceptance can pay less than requested, never more, and the report shows the reduction", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(true)) }, async ({ call }) => {
    await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
    assert.equal((await accept(call, CLAIM, { approvedAmountVnd: 2450001 })).status, 400);
    assert.equal((await accept(call, CLAIM, { approvedAmountVnd: 0 })).status, 400);
    const partial = await accept(call, CLAIM, { approvedAmountVnd: 2000000 });
    assert.equal(partial.status, 201);
    assert.equal(partial.json.claim.approvedAmountVnd, 2000000);
    const { json } = await call("/api/report");
    assert.equal(json.total.acceptedVnd, 2000000);
    assert.equal(json.total.reducedVnd, 450000);
    assert.equal(json.total.unsettledVnd, 2000000);
  });
});

test("only an acceptance can name an amount", async () => {
  await withApp({}, async ({ call }) => {
    const rejected = await call(`/api/claims/${CLAIM}/decision`, { method: "POST", body: { kind: "rejected", reason: "Lệch số tiền", approvedAmountVnd: 1000 } });
    assert.equal(rejected.status, 400);
  });
});

test("the queue shows the due date from the clock, and the detail lists the member's other claims", async () => {
  const clock = () => new Date("2026-11-10T00:00:00.000Z");
  await withApp({ clock, slaDays: 30 }, async ({ call }) => {
    const queue = (await call("/api/claims")).json;
    assert.equal(queue.slaDays, 30);
    const byId = Object.fromEntries(queue.items.map(item => [item.claimId, item]));
    assert.equal(byId["HS-2026-00001"].overdue, false);
    assert.equal(byId["HS-2026-00001"].daysLeft, 10);
    assert.equal(byId["HS-2026-00002"].overdue, true);
    assert.equal(queue.overdue, 2);
    const detail = (await call(`/api/claims/${CLAIM}`)).json;
    assert.deepEqual(detail.related, []);
  });
});

test("settling groups the accepted claims once, and the batch can be downloaded", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(true)) }, async ({ call }) => {
    assert.equal((await call("/api/settlements", { method: "POST", body: {} })).status, 409);
    for (const id of ["HS-2026-00001", "HS-2026-00002"]) await call(`/api/claims/${id}/verify`, { method: "POST" });
    await accept(call, "HS-2026-00001", { approvedAmountVnd: 2000000 });
    await accept(call, "HS-2026-00002");
    const before = (await call("/api/settlements")).json;
    assert.equal(before.pending.count, 2);
    assert.equal(before.pending.totalVnd, 5018000);
    assert.deepEqual(before.items, []);
    assert.equal(JSON.stringify(before).includes(SUBJECTS.a), false);

    const made = await call("/api/settlements", { method: "POST", body: {} });
    assert.equal(made.status, 201);
    assert.match(made.json.settlement.settlementId, /^QT-\d{8}-01$/);
    assert.equal(made.json.settlement.count, 2);
    assert.equal(made.json.settlement.totalVnd, 5018000);
    assert.equal((await call("/api/settlements", { method: "POST", body: {} })).status, 409);

    const after = (await call("/api/settlements")).json;
    assert.equal(after.pending.count, 0);
    assert.equal(after.items.length, 1);
    const claim = (await call(`/api/claims/HS-2026-00001`)).json.claim;
    assert.equal(claim.settlementId, made.json.settlement.settlementId);
    assert.equal((await call("/api/report")).json.total.settledVnd, 5018000);

    const csv = await call(`/api/settlements/${made.json.settlement.settlementId}/csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-disposition"), /QT-\d{8}-01\.csv/);
    assert.ok(csv.text.includes("HS-2026-00001"));
    assert.ok(csv.text.includes(",5018000,"));
    assert.equal(csv.text.includes(SUBJECTS.a), false);
    assert.equal((await call("/api/settlements/QT-19990101-01/csv")).status, 404);
  });
});

test("two decisions sent together cannot both accept the same claim", async () => {
  await withApp({ capabilities: fakeCapabilities(answerOk(true)) }, async ({ call }) => {
    await call(`/api/claims/${CLAIM}/verify`, { method: "POST" });
    const results = await Promise.all([accept(call, CLAIM), accept(call, CLAIM), accept(call, CLAIM)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409, 409]);
  });
});

test("settlements need an assessor and the record store", async () => {
  await withApp({}, async ({ call, signer }) => {
    assert.equal((await call("/api/settlements", { auth: null })).status, 401);
    assert.equal((await call("/api/settlements", { auth: signer.sign({ preferred_username: "nhanvien.khac" }) })).status, 403);
    assert.equal((await call("/api/settlements", { method: "PUT", body: {} })).status, 405);
  });
  await withApp({ stores: { callLog: null, checks: null, decisions: null, settlements: null } }, async ({ call }) => {
    assert.equal((await call("/api/settlements")).status, 503);
  });
});
