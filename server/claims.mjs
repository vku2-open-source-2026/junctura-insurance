// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0

export const DECISION_KINDS = Object.freeze(["accepted", "rejected", "explain"]);
const FINAL = new Set(["accepted", "rejected"]);
const REASON_MIN = 3;
const REASON_MAX = 300;
const DAY = 86_400_000;
const VIETNAM_OFFSET = 7 * 3_600_000;
/** Claims of one member this close together are flagged for a closer look. */
const REPEAT_WINDOW_DAYS = 30;
/** An amount above this many times the median is flagged as unusually high. */
const HIGH_AMOUNT_FACTOR = 2;
const HIGH_AMOUNT_MIN_CLAIMS = 5;

/** Short reference shown instead of the member's identifier. */
export const memberRef = subject => `…${String(subject).replaceAll("-", "").slice(-6).toUpperCase()}`;

const newestFor = (list, claimId) => list.find(entry => entry.claimId === claimId) ?? null;

/**
 * One claim as the browser sees it. The member's identifier stays on the server, and the
 * only thing known about the treatment is whether the claim matched: a yes or a no.
 * Lists must be newest first. `settlementOf` maps a claim id to the settlement that paid it.
 */
export function buildClaim(request, { facility, checks = [], decisions = [], settlementOf = new Map(), now = new Date(), slaDays = 30 }) {
  const check = newestFor(checks, request.claimId);
  const decision = newestFor(decisions, request.claimId);
  const status = decision ? decision.kind : check ? (check.matches ? "match" : "mismatch") : "new";
  const dueMs = Date.parse(request.submittedAt) + slaDays * DAY;
  const open = !FINAL.has(status);
  const accepted = decision?.kind === "accepted";
  const approvedAmountVnd = accepted ? (Number.isInteger(decision.amountVnd) ? decision.amountVnd : request.requestedAmountVnd) : null;
  return {
    claimId: request.claimId,
    memberRef: memberRef(request.subject),
    facility,
    requestedAmountVnd: request.requestedAmountVnd,
    submittedAt: request.submittedAt,
    status,
    dueAt: new Date(dueMs).toISOString(),
    daysLeft: open ? Math.ceil((dueMs - now.getTime()) / DAY) : null,
    overdue: open && now.getTime() > dueMs,
    approvedAmountVnd,
    settlementId: accepted ? (settlementOf.get(request.claimId) ?? null) : null,
    flags: [],
    check: check ? { matches: check.matches, checkedAt: check.checkedAt, assessorName: check.assessorName } : null,
    decision: decision ? { kind: decision.kind, reason: decision.reason, at: decision.at, assessorName: decision.assessorName } : null,
  };
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Plain, explainable reasons to look closer at a claim. They use only what the insurer owns
 * (amounts, dates, earlier answers), never treatment data, and never block a decision.
 */
function addFlags(items, requestOf) {
  const bySubject = new Map();
  for (const item of items) {
    const subject = requestOf(item).subject;
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), item]);
  }
  const typical = items.length >= HIGH_AMOUNT_MIN_CLAIMS ? median(items.map(item => item.requestedAmountVnd)) : null;
  for (const item of items) {
    const others = (bySubject.get(requestOf(item).subject) ?? []).filter(other => other.claimId !== item.claimId);
    const near = others.filter(other => Math.abs(Date.parse(other.submittedAt) - Date.parse(item.submittedAt)) <= REPEAT_WINDOW_DAYS * DAY);
    const troubled = others.filter(other => other.status === "mismatch" || other.status === "rejected");
    if (near.length > 0) item.flags.push({ code: "repeat", count: near.length, days: REPEAT_WINDOW_DAYS });
    if (typical !== null && item.requestedAmountVnd > typical * HIGH_AMOUNT_FACTOR) item.flags.push({ code: "high-amount", factor: HIGH_AMOUNT_FACTOR });
    if (troubled.length > 0) item.flags.push({ code: "history", count: troubled.length });
  }
}

/** Claims newest submission first, with the counts the queue header shows. */
export function buildQueue(data, { checks = [], decisions = [], settlements = [] }, { now = new Date(), slaDays = 30 } = {}) {
  const settlementOf = new Map();
  for (const settlement of settlements) for (const id of settlement.claimIds ?? []) if (!settlementOf.has(id)) settlementOf.set(id, settlement.settlementId);
  const items = [...data.claims.values()]
    .map(request => buildClaim(request, { facility: data.facility, checks, decisions, settlementOf, now, slaDays }))
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt));
  addFlags(items, item => data.claims.get(item.claimId));
  const counts = { new: 0, match: 0, mismatch: 0, explain: 0, accepted: 0, rejected: 0 };
  for (const item of items) counts[item.status]++;
  const waiting = items.filter(item => item.status === "accepted" && !item.settlementId);
  return {
    items, counts, slaDays,
    open: items.filter(item => !FINAL.has(item.status)).length,
    overdue: items.filter(item => item.overdue).length,
    flagged: items.filter(item => item.flags.length > 0 && !FINAL.has(item.status)).length,
    unsettled: { count: waiting.length, totalVnd: waiting.reduce((sum, item) => sum + item.approvedAmountVnd, 0) },
  };
}

/** The other claims of the same member, newest first. Only what the insurer already holds. */
export function relatedClaims(data, items, claimId) {
  const subject = data.claims.get(claimId)?.subject;
  return items
    .filter(item => item.claimId !== claimId && data.claims.get(item.claimId)?.subject === subject)
    .map(({ claimId: id, submittedAt, requestedAmountVnd, status, approvedAmountVnd }) => ({ claimId: id, submittedAt, requestedAmountVnd, status, approvedAmountVnd }));
}

/**
 * Returns the cleaned decision, or null when it is not acceptable. Only an acceptance can name
 * an amount, and it can never exceed what was requested; leaving it out accepts the full amount.
 */
export function validDecision(body, requestedAmountVnd) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { kind } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const length = [...reason].length;
  if (!DECISION_KINDS.includes(kind) || length < REASON_MIN || length > REASON_MAX) return null;
  let amountVnd = requestedAmountVnd;
  if (body.approvedAmountVnd !== undefined) {
    const value = body.approvedAmountVnd;
    if (kind !== "accepted" || !Number.isInteger(value) || value < 1 || value > requestedAmountVnd) return null;
    amountVnd = value;
  }
  return { kind, reason, amountVnd };
}

/**
 * Why a decision cannot be recorded now, or null when it can. A claim can only be accepted
 * after a check found that it matches; a final decision is never changed.
 */
export function decisionBlocker(claim, kind) {
  if (FINAL.has(claim.status)) return "already-decided";
  if (kind === "accepted" && claim.check?.matches !== true) return "not-verified";
  return null;
}

export const monthOf = iso => new Date(Date.parse(iso) + VIETNAM_OFFSET).toISOString().slice(0, 7);
const dayOf = iso => new Date(Date.parse(iso) + VIETNAM_OFFSET).toISOString().slice(0, 10).replaceAll("-", "");

/**
 * Groups every accepted claim that no settlement has paid yet into one batch, or returns null
 * when there is nothing to pay. The number counts the batches already made on the same day.
 */
export function planSettlement(items, settlements, { at, assessor, assessorName }) {
  const claims = items.filter(item => item.status === "accepted" && !item.settlementId);
  if (claims.length === 0) return null;
  const day = dayOf(at);
  const sameDay = settlements.filter(entry => entry.settlementId?.startsWith(`QT-${day}-`)).length;
  return {
    settlementId: `QT-${day}-${String(sameDay + 1).padStart(2, "0")}`,
    claimIds: claims.map(claim => claim.claimId),
    count: claims.length,
    totalVnd: claims.reduce((sum, claim) => sum + claim.approvedAmountVnd, 0),
    createdBy: assessor, createdByName: assessorName, at,
  };
}
