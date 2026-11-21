// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { monthOf } from "./claims.mjs";

/**
 * Totals and a per-month series over the whole queue. The mismatch rate counts only claims
 * that were checked, and is null until one has been.
 */
export function buildReport(claims) {
  const months = new Map();
  const total = { claims: 0, checked: 0, mismatches: 0, acceptedVnd: 0, reducedVnd: 0, rejectedVnd: 0, openVnd: 0, overdue: 0, settledVnd: 0, unsettledVnd: 0 };
  for (const claim of claims) {
    const row = months.get(monthOf(claim.submittedAt)) ?? { claims: 0, checked: 0, mismatches: 0, acceptedVnd: 0, reducedVnd: 0, rejectedVnd: 0 };
    for (const target of [row, total]) {
      target.claims++;
      if (claim.check) target.checked++;
      if (claim.check && !claim.check.matches) target.mismatches++;
      if (claim.status === "accepted") {
        target.acceptedVnd += claim.approvedAmountVnd;
        target.reducedVnd += claim.requestedAmountVnd - claim.approvedAmountVnd;
      }
      if (claim.status === "rejected") target.rejectedVnd += claim.requestedAmountVnd;
    }
    if (claim.status !== "accepted" && claim.status !== "rejected") total.openVnd += claim.requestedAmountVnd;
    if (claim.overdue) total.overdue++;
    if (claim.status === "accepted") total[claim.settlementId ? "settledVnd" : "unsettledVnd"] += claim.approvedAmountVnd;
    months.set(monthOf(claim.submittedAt), row);
  }
  const rate = row => (row.checked === 0 ? null : Math.round((row.mismatches / row.checked) * 1000) / 10);
  return {
    total: { ...total, mismatchRate: rate(total) },
    months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, row]) => ({ month, ...row, mismatchRate: rate(row) })),
  };
}

const csvCell = value => {
  const text = String(value ?? "");
  // A leading formula character would be run by a spreadsheet, so it is defused.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function reportCsv(report) {
  const head = ["Tháng", "Hồ sơ", "Đã đối chiếu", "Không khớp", "Tỷ lệ không khớp (%)", "Đã chấp nhận (VND)", "Giảm trừ (VND)", "Đã từ chối (VND)"];
  const rows = report.months.map(row => [row.month, row.claims, row.checked, row.mismatches, row.mismatchRate ?? "", row.acceptedVnd, row.reducedVnd, row.rejectedVnd]);
  return `\uFEFF${[head, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** One settlement as a spreadsheet: what was paid for each claim, without any treatment detail. */
export function settlementCsv(settlement, claims) {
  const head = ["Đợt quyết toán", "Mã hồ sơ", "Thành viên", "Cơ sở điều trị", "Số tiền đề nghị (VND)", "Số tiền chấp nhận (VND)", "Giảm trừ (VND)", "Ngày quyết định"];
  const rows = claims.map(claim => [settlement.settlementId, claim.claimId, claim.memberRef, claim.facility, claim.requestedAmountVnd, claim.approvedAmountVnd, claim.requestedAmountVnd - claim.approvedAmountVnd, claim.decision?.at ?? ""]);
  rows.push([settlement.settlementId, "Tổng", "", "", "", settlement.totalVnd, "", ""]);
  return `\uFEFF${[head, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
