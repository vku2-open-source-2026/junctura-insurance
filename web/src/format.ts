// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import type { Tone } from "@junctura/health-ui";
import type { CallOutcome, Claim, ClaimStatus, DecisionKind, Flag } from "./types";

const VND = new Intl.NumberFormat("vi-VN");
/** "10.351.000 ₫". */
export const formatVnd = (value: number) => `${VND.format(value)} ₫`;
/** "10,4 triệu" for charts and tight spaces. */

export const formatRate = (rate: number | null) => (rate === null ? "Chưa có" : `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(rate)}%`);
/** "2026-10" to "10/2026". */
export const monthLabel = (month: string) => `${month.slice(5)}/${month.slice(0, 4)}`;

export const STATUS: Record<ClaimStatus, { label: string; tone: Tone }> = {
  new: { label: "Chưa đối chiếu", tone: "neutral" },
  match: { label: "Khớp", tone: "ok" },
  mismatch: { label: "Không khớp", tone: "warn" },
  explain: { label: "Chờ giải trình", tone: "brand" },
  accepted: { label: "Đã chấp nhận", tone: "ok" },
  rejected: { label: "Đã từ chối", tone: "danger" },
};

export const DECISION_LABEL: Record<DecisionKind, string> = { accepted: "Chấp nhận", rejected: "Từ chối", explain: "Yêu cầu giải trình" };

export const OUTCOME: Record<CallOutcome, { label: string; tone: Tone }> = {
  ok: { label: "Thành công", tone: "ok" },
  "no-consent": { label: "Chưa có đồng thuận", tone: "warn" },
  "not-authorized": { label: "Chưa được cấp quyền", tone: "warn" },
  unavailable: { label: "Không kết nối được", tone: "danger" },
  failed: { label: "Lỗi", tone: "danger" },
  "invalid-output": { label: "Lỗi", tone: "danger" },
};

export const isFinal = (status: ClaimStatus) => status === "accepted" || status === "rejected";

/** The claim to work on next: the oldest one still open, unchecked claims first. */
export function nextOpenClaim<T extends { status: ClaimStatus; submittedAt: string; claimId: string }>(claims: T[], except?: string): T | null {
  const open = claims.filter(claim => !isFinal(claim.status) && claim.claimId !== except);
  const rank = (claim: T) => (claim.status === "new" ? 0 : claim.status === "mismatch" || claim.status === "match" ? 1 : 2);
  return [...open].sort((a, b) => rank(a) - rank(b) || Date.parse(a.submittedAt) - Date.parse(b.submittedAt))[0] ?? null;
}

/** "Còn 5 ngày", "Hết hạn hôm nay" or "Quá hạn 3 ngày"; null once the claim is decided. */
export function dueText(claim: Pick<Claim, "daysLeft">): string | null {
  const days = claim.daysLeft;
  if (days === null) return null;
  if (days < 0) return `Quá hạn ${-days} ngày`;
  return days === 0 ? "Hết hạn hôm nay" : `Còn ${days} ngày`;
}

/** Due soon: a week or less left, but not yet overdue. */
export const dueSoon = (claim: Pick<Claim, "daysLeft" | "overdue">) => !claim.overdue && claim.daysLeft !== null && claim.daysLeft <= 7;

/** Why a claim is flagged, in words the assessor can check against the other claims. */
export function flagText(flag: Flag): string {
  switch (flag.code) {
    case "repeat": return `Người này còn ${flag.count} hồ sơ khác trong vòng ${flag.days} ngày.`;
    case "high-amount": return `Số tiền cao hơn ${flag.factor} lần mức trung vị của các hồ sơ.`;
    case "history": return `Người này có ${flag.count} hồ sơ khác từng không khớp hoặc bị từ chối.`;
  }
}

/** A short label for tables, where the full sentence does not fit. */
export const FLAG_SHORT: Record<Flag["code"], string> = { repeat: "Nhiều hồ sơ", "high-amount": "Số tiền cao", history: "Có tiền lệ" };
