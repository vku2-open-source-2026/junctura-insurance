// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { dueSoon, dueText, flagText, formatRate, formatVnd, isFinal, monthLabel, nextOpenClaim, STATUS } from "./format";
import type { ClaimStatus } from "./types";

const claim = (claimId: string, status: ClaimStatus, submittedAt: string) => ({ claimId, status, submittedAt });

describe("format", () => {
  it("writes money with dot separators and the dong sign", () => {
    expect(formatVnd(10351000)).toMatch(/^10\.351\.000\s₫$/);
    expect(formatVnd(0)).toMatch(/^0\s₫$/);
  });
  it("writes a missing rate as 'Chưa có' and a real one with a percent sign", () => {
    expect(formatRate(null)).toBe("Chưa có");
    expect(formatRate(33.3)).toMatch(/^33,3\s?%$/);
    expect(formatRate(0)).toMatch(/^0\s?%$/);
  });
  it("writes months as month/year", () => {
    expect(monthLabel("2026-09")).toBe("09/2026");
  });
  it("has a label for every status, and only accepted and rejected are final", () => {
    for (const status of ["new", "match", "mismatch", "explain", "accepted", "rejected"] as const) expect(STATUS[status].label).not.toBe("");
    expect(["new", "match", "mismatch", "explain", "accepted", "rejected"].filter(status => isFinal(status as ClaimStatus))).toEqual(["accepted", "rejected"]);
  });
});

describe("nextOpenClaim", () => {
  it("takes the oldest unchecked claim first, then checked ones, then those waiting for an explanation", () => {
    const claims = [
      claim("A", "explain", "2026-01-01T00:00:00.000Z"),
      claim("B", "match", "2026-02-01T00:00:00.000Z"),
      claim("C", "new", "2026-03-01T00:00:00.000Z"),
      claim("D", "new", "2026-02-15T00:00:00.000Z"),
      claim("E", "accepted", "2025-01-01T00:00:00.000Z"),
    ];
    expect(nextOpenClaim(claims)?.claimId).toBe("D");
    expect(nextOpenClaim(claims, "D")?.claimId).toBe("C");
    expect(nextOpenClaim(claims.filter(item => item.claimId !== "C" && item.claimId !== "D"))?.claimId).toBe("B");
  });
  it("returns null when nothing is open", () => {
    expect(nextOpenClaim([claim("A", "rejected", "2026-01-01T00:00:00.000Z")])).toBeNull();
    expect(nextOpenClaim([])).toBeNull();
  });
});

describe("due dates and flags", () => {
  it("says how many days are left, today, or overdue, and nothing once decided", () => {
    expect(dueText({ daysLeft: 5 })).toBe("Còn 5 ngày");
    expect(dueText({ daysLeft: 0 })).toBe("Hết hạn hôm nay");
    expect(dueText({ daysLeft: -3 })).toBe("Quá hạn 3 ngày");
    expect(dueText({ daysLeft: null })).toBeNull();
  });

  it("marks a claim as due soon only in the last week and before it is overdue", () => {
    expect(dueSoon({ daysLeft: 7, overdue: false })).toBe(true);
    expect(dueSoon({ daysLeft: 8, overdue: false })).toBe(false);
    expect(dueSoon({ daysLeft: -1, overdue: true })).toBe(false);
    expect(dueSoon({ daysLeft: null, overdue: false })).toBe(false);
  });

  it("writes every flag as a sentence the assessor can check", () => {
    expect(flagText({ code: "repeat", count: 2, days: 30 })).toBe("Người này còn 2 hồ sơ khác trong vòng 30 ngày.");
    expect(flagText({ code: "high-amount", factor: 2 })).toBe("Số tiền cao hơn 2 lần mức trung vị của các hồ sơ.");
    expect(flagText({ code: "history", count: 1 })).toBe("Người này có 1 hồ sơ khác từng không khớp hoặc bị từ chối.");
  });
});
