// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { buildClaim, buildQueue, decisionBlocker, memberRef, monthOf, planSettlement, relatedClaims, validDecision } from "../server/claims.mjs";
import { buildInsuranceData } from "../server/data.mjs";
import { buildReport, reportCsv } from "../server/report.mjs";
import { createEventLog } from "../server/event-log.mjs";
import { fixture, memoryClient } from "./helpers.mjs";

const request = { claimId: "HS-1", subject: "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d", requestedAmountVnd: 1000, submittedAt: "2026-10-01T05:00:00.000Z" };
const view = (extra = {}) => buildClaim(request, { facility: "BV", ...extra });

test("a claim's status follows its newest decision, then its newest check", () => {
  assert.equal(view().status, "new");
  assert.equal(view({ checks: [{ claimId: "HS-1", matches: true, checkedAt: "x", at: "x" }] }).status, "match");
  assert.equal(view({ checks: [{ claimId: "HS-1", matches: false }, { claimId: "HS-1", matches: true }] }).status, "mismatch");
  assert.equal(view({ checks: [{ claimId: "HS-2", matches: false }] }).status, "new");
  assert.equal(view({ decisions: [{ claimId: "HS-1", kind: "explain", at: "x" }], checks: [{ claimId: "HS-1", matches: true }] }).status, "explain");
  assert.equal(view({ decisions: [{ claimId: "HS-1", kind: "accepted", reason: "r", at: "x" }] }).status, "accepted");
});

test("the built claim keeps the member identifier out", () => {
  const claim = view();
  assert.equal(JSON.stringify(claim).includes(request.subject), false);
  assert.equal(claim.memberRef, memberRef(request.subject));
  assert.equal(memberRef("0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d"), "…9F0A1B".replace("9F0A1B", "1B2C3D"));
});

test("decisions: only a matching check allows accepting, and a final decision is never changed", () => {
  const match = view({ checks: [{ claimId: "HS-1", matches: true }] });
  assert.equal(decisionBlocker(view(), "accepted"), "not-verified");
  assert.equal(decisionBlocker(view({ checks: [{ claimId: "HS-1", matches: false }] }), "accepted"), "not-verified");
  assert.equal(decisionBlocker(match, "accepted"), null);
  assert.equal(decisionBlocker(view(), "rejected"), null);
  assert.equal(decisionBlocker(view(), "explain"), null);
  const done = view({ decisions: [{ claimId: "HS-1", kind: "rejected", reason: "r", at: "x" }] });
  for (const kind of ["accepted", "rejected", "explain"]) assert.equal(decisionBlocker(done, kind), "already-decided");
  const asked = view({ decisions: [{ claimId: "HS-1", kind: "explain", reason: "r", at: "x" }], checks: [{ claimId: "HS-1", matches: true }] });
  assert.equal(decisionBlocker(asked, "accepted"), null);
});

test("a decision body is cleaned and bounded by characters, not bytes", () => {
  assert.deepEqual(validDecision({ kind: "rejected", reason: "  lý do  ", extra: 1 }, 500), { kind: "rejected", reason: "lý do", amountVnd: 500 });
  assert.equal(validDecision({ kind: "rejected", reason: "ẩẩ" }, 500), null);
  assert.deepEqual(validDecision({ kind: "explain", reason: "ẩ".repeat(300) }, 500)?.kind, "explain");
  assert.equal(validDecision({ kind: "explain", reason: "ẩ".repeat(301) }, 500), null);
  assert.equal(validDecision({ kind: "explain", reason: 123 }, 500), null);
  assert.equal(validDecision(null, 500), null);
});

test("the queue is sorted newest first with a count per status", () => {
  const data = buildInsuranceData(fixture);
  const queue = buildQueue(data, { checks: [], decisions: [{ claimId: "HS-2026-00002", kind: "rejected", reason: "r", at: "2026-11-01T00:00:00.000Z" }] });
  assert.deepEqual(queue.items.map(item => item.claimId), ["HS-2026-00001", "HS-2026-00003", "HS-2026-00002"]);
  assert.deepEqual(queue.counts, { new: 2, match: 0, mismatch: 0, explain: 0, accepted: 0, rejected: 1 });
  assert.equal(queue.open, 2);
});

test("data: only this application's staff and well-formed claims are loaded", () => {
  const data = buildInsuranceData({
    accounts: fixture.accounts,
    requests: { claimRequests: [...fixture.requests.claimRequests, { claimId: 5 }, { claimId: "X", subject: "s", requestedAmountVnd: 1.5 }, null] },
  });
  assert.deepEqual([...data.staff.keys()].sort(), ["giamdinh.baohiem", "nhanvien.khac"]);
  assert.equal(data.claims.size, 3);
  assert.equal(data.facility, "Cơ sở điều trị");
});

test("months are counted in Vietnam time", () => {
  assert.equal(monthOf("2026-09-30T18:00:00.000Z"), "2026-10");
  assert.equal(monthOf("2026-09-30T16:59:59.000Z"), "2026-09");
});

test("the report has no mismatch rate before anything was checked, and defuses spreadsheet formulas", () => {
  const empty = buildReport([]);
  assert.equal(empty.total.mismatchRate, null);
  assert.deepEqual(empty.months, []);
  const report = { months: [{ month: "=1+1", claims: 1, checked: 0, mismatches: 0, mismatchRate: null, acceptedVnd: 0, reducedVnd: 0, rejectedVnd: 0 }] };
  assert.ok(reportCsv(report).includes("'=1+1,1,0,0,,0,0,0"));
});

test("an event log keeps only its fields and skips malformed records", async () => {
  const client = memoryClient();
  const log = createEventLog({ client, collection: "checks", fields: ["claimId", "matches", "at"] });
  await log.add({ claimId: "HS-1", matches: true, at: "2026-11-01T00:00:00.000Z", subject: request.subject, diagnosis: "x" });
  await client.createRecord("checks", { matches: true });
  await client.createRecord("checks", { claimId: "HS-2", matches: false, at: "2026-11-02T00:00:00.000Z" });
  assert.deepEqual(client.records[0].data, { claimId: "HS-1", matches: true, at: "2026-11-01T00:00:00.000Z" });
  assert.deepEqual((await log.list()).map(entry => entry.claimId), ["HS-2", "HS-1"]);
  const failing = createEventLog({ client: memoryClient({ createError: new Error("down") }), collection: "checks", fields: ["claimId"] });
  await assert.rejects(failing.add({ claimId: "HS-1" }), { status: 503, code: "store-unavailable" });
});

test("only an acceptance can name an amount, and never above the request", () => {
  assert.deepEqual(validDecision({ kind: "accepted", reason: "Trừ phần ngoài danh mục", approvedAmountVnd: 400 }, 500), { kind: "accepted", reason: "Trừ phần ngoài danh mục", amountVnd: 400 });
  assert.equal(validDecision({ kind: "accepted", reason: "abc", approvedAmountVnd: 501 }, 500), null);
  assert.equal(validDecision({ kind: "accepted", reason: "abc", approvedAmountVnd: 0 }, 500), null);
  assert.equal(validDecision({ kind: "accepted", reason: "abc", approvedAmountVnd: 1.5 }, 500), null);
  assert.equal(validDecision({ kind: "accepted", reason: "abc", approvedAmountVnd: "400" }, 500), null);
  assert.equal(validDecision({ kind: "rejected", reason: "abc", approvedAmountVnd: 400 }, 500), null);
  assert.equal(validDecision({ kind: "accepted", reason: "abc" }, 500).amountVnd, 500);
});

test("the due date follows the submission date, and only open claims can be overdue", () => {
  const now = new Date("2026-11-20T00:00:00.000Z");
  const open = view({ now, slaDays: 30 });
  assert.equal(open.dueAt, "2026-10-31T05:00:00.000Z");
  assert.equal(open.overdue, true);
  assert.equal(open.daysLeft, -19);
  const fresh = view({ now: new Date("2026-10-10T05:00:00.000Z"), slaDays: 30 });
  assert.equal(fresh.overdue, false);
  assert.equal(fresh.daysLeft, 21);
  const done = view({ now, slaDays: 30, decisions: [{ claimId: "HS-1", kind: "rejected", reason: "r", at: "x" }] });
  assert.equal(done.overdue, false);
  assert.equal(done.daysLeft, null);
});

test("an accepted claim carries the approved amount and the settlement that paid it", () => {
  const decisions = [{ claimId: "HS-1", kind: "accepted", reason: "r", amountVnd: 800, at: "x" }];
  assert.equal(view({ decisions }).approvedAmountVnd, 800);
  assert.equal(view({ decisions }).settlementId, null);
  assert.equal(view({ decisions, settlementOf: new Map([["HS-1", "QT-20261120-01"]]) }).settlementId, "QT-20261120-01");
  assert.equal(view().approvedAmountVnd, null);
});

const flagData = () => {
  const claims = [
    ["A1", "m1", 1_000_000, "2026-10-01T00:00:00.000Z"], ["A2", "m1", 1_200_000, "2026-10-10T00:00:00.000Z"], ["A3", "m1", 1_100_000, "2026-03-01T00:00:00.000Z"],
    ["B1", "m2", 1_000_000, "2026-10-05T00:00:00.000Z"], ["C1", "m3", 9_000_000, "2026-10-06T00:00:00.000Z"], ["D1", "m4", 1_000_000, "2026-10-07T00:00:00.000Z"],
  ];
  return { facility: "BV", claims: new Map(claims.map(([claimId, subject, requestedAmountVnd, submittedAt]) => [claimId, { claimId, subject, requestedAmountVnd, submittedAt }])) };
};

test("flags explain why to look closer, using only amounts, dates and earlier answers", () => {
  const queue = buildQueue(flagData(), { checks: [{ claimId: "A3", matches: false }], decisions: [] }, { now: new Date("2026-10-20T00:00:00.000Z") });
  const flags = id => queue.items.find(item => item.claimId === id).flags;
  assert.deepEqual(flags("A1"), [{ code: "repeat", count: 1, days: 30 }, { code: "history", count: 1 }]);
  assert.deepEqual(flags("A2").map(flag => flag.code), ["repeat", "history"]);
  assert.deepEqual(flags("C1"), [{ code: "high-amount", factor: 2 }]);
  assert.deepEqual(flags("B1"), []);
  assert.equal(queue.flagged, 3);
});

test("high amounts are not flagged when there are too few claims to compare", () => {
  const data = { facility: "BV", claims: new Map([["A", { claimId: "A", subject: "x", requestedAmountVnd: 9_000_000, submittedAt: "2026-10-01T00:00:00.000Z" }], ["B", { claimId: "B", subject: "y", requestedAmountVnd: 1_000, submittedAt: "2026-10-01T00:00:00.000Z" }]]) };
  assert.deepEqual(buildQueue(data, {}).items.flatMap(item => item.flags), []);
});

test("related claims are the member's other claims, without the member identifier", () => {
  const data = flagData();
  const { items } = buildQueue(data, {}, {});
  const related = relatedClaims(data, items, "A1");
  assert.deepEqual(related.map(item => item.claimId), ["A2", "A3"]);
  assert.equal(JSON.stringify(related).includes("m1"), false);
});

test("a settlement groups the accepted claims that were not paid yet and counts per day", () => {
  const data = flagData();
  const decisions = [
    { claimId: "A1", kind: "accepted", reason: "r", amountVnd: 900_000, at: "2026-10-15T01:00:00.000Z" },
    { claimId: "B1", kind: "accepted", reason: "r", amountVnd: 1_000_000, at: "2026-10-15T01:00:00.000Z" },
    { claimId: "C1", kind: "rejected", reason: "r", amountVnd: 9_000_000, at: "2026-10-15T01:00:00.000Z" },
  ];
  const who = { assessor: "u", assessorName: "U" };
  const first = planSettlement(buildQueue(data, { decisions }).items, [], { at: "2026-10-16T02:00:00.000Z", ...who });
  assert.deepEqual({ id: first.settlementId, ids: first.claimIds.sort(), count: first.count, total: first.totalVnd }, { id: "QT-20261016-01", ids: ["A1", "B1"], count: 2, total: 1_900_000 });
  const paid = [first];
  assert.equal(planSettlement(buildQueue(data, { decisions, settlements: paid }).items, paid, { at: "2026-10-16T03:00:00.000Z", ...who }), null);
  const more = [...decisions, { claimId: "D1", kind: "accepted", reason: "r", amountVnd: 1_000_000, at: "2026-10-16T01:00:00.000Z" }];
  const second = planSettlement(buildQueue(data, { decisions: more, settlements: paid }).items, paid, { at: "2026-10-16T04:00:00.000Z", ...who });
  assert.deepEqual({ id: second.settlementId, ids: second.claimIds }, { id: "QT-20261016-02", ids: ["D1"] });
});

test("the demo dates move forward by whole days from the seed's reference date", () => {
  const requests = { referenceDate: "2026-11-01", claimRequests: [{ claimId: "X", subject: "s", requestedAmountVnd: 1, submittedAt: "2026-10-31T05:00:00.000Z" }] };
  const moved = buildInsuranceData({ accounts: fixture.accounts, requests, today: new Date("2026-11-21T09:00:00.000Z") });
  assert.equal(moved.claims.get("X").submittedAt, "2026-11-20T05:00:00.000Z");
  const same = buildInsuranceData({ accounts: fixture.accounts, requests });
  assert.equal(same.claims.get("X").submittedAt, "2026-10-31T05:00:00.000Z");
  const earlier = buildInsuranceData({ accounts: fixture.accounts, requests, today: new Date("2026-10-01T00:00:00.000Z") });
  assert.equal(earlier.claims.get("X").submittedAt, "2026-10-31T05:00:00.000Z");
});
