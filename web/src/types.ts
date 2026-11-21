// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0

export interface PublicConfig { issuer: string; clientId: string; facility: string }
export interface Me { username: string; displayName: string; role: string }

export type ClaimStatus = "new" | "match" | "mismatch" | "explain" | "accepted" | "rejected";
export type DecisionKind = "accepted" | "rejected" | "explain";

export type FlagCode = "repeat" | "high-amount" | "history";
/** A plain reason to look closer at a claim. Built from amounts, dates and earlier answers only. */
export interface Flag { code: FlagCode; count?: number; days?: number; factor?: number }

export interface Claim {
  claimId: string;
  memberRef: string;
  facility: string;
  requestedAmountVnd: number;
  submittedAt: string;
  status: ClaimStatus;
  dueAt: string;
  /** Days until the due date (negative once overdue); null when the claim has a final decision. */
  daysLeft: number | null;
  overdue: boolean;
  /** What was accepted, which can be less than requested; null unless accepted. */
  approvedAmountVnd: number | null;
  /** The payment batch that paid this claim, once there is one. */
  settlementId: string | null;
  flags: Flag[];
  check: { matches: boolean; checkedAt: string; assessorName?: string } | null;
  decision: { kind: DecisionKind; reason: string; at: string; assessorName?: string } | null;
}

export interface QueueResult {
  items: Claim[]; counts: Record<ClaimStatus, number>; open: number; overdue: number; flagged: number; slaDays: number;
  unsettled: { count: number; totalVnd: number }; facility: string; generatedAt: string;
}

/** What Junctura answered for one check. Only a yes or no ever comes back; the rest is why there is none. */
export type CheckOutcome =
  | { status: "ok"; matches: boolean; checkedAt: string }
  | { status: "no-consent" | "unavailable" | "not-authorized" | "failed" | "invalid-output" };
export interface VerifyResult { result: CheckOutcome; saved: boolean; claim: Claim }

export type HistoryEntry =
  | { type: "check"; at: string; matches: boolean; assessorName?: string }
  | { type: "decision"; at: string; kind: DecisionKind; reason: string; assessorName?: string };
export interface RelatedClaim { claimId: string; submittedAt: string; requestedAmountVnd: number; status: ClaimStatus; approvedAmountVnd: number | null }
export interface ClaimDetail { claim: Claim; history: HistoryEntry[]; related: RelatedClaim[] }

export interface Settlement { settlementId: string; count: number; totalVnd: number; createdByName?: string; at: string }
export interface PendingClaim { claimId: string; memberRef: string; requestedAmountVnd: number; approvedAmountVnd: number; decidedAt: string | null }
export interface SettlementsResult { items: Settlement[]; pending: { count: number; totalVnd: number; claims: PendingClaim[] } }

export type CallOutcome = CheckOutcome["status"];
export interface CallLogItem { capability: string; purpose: string; outcome: CallOutcome; claimId: string; assessor?: string; assessorName?: string; at: string }
export interface CallLogResult { items: CallLogItem[] }

export interface ReportRow { claims: number; checked: number; mismatches: number; mismatchRate: number | null; acceptedVnd: number; reducedVnd: number; rejectedVnd: number }
export interface ReportResult { total: ReportRow & { openVnd: number; overdue: number; settledVnd: number; unsettledVnd: number }; months: (ReportRow & { month: string })[]; generatedAt: string }
