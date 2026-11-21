// @vitest-environment jsdom
// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { ToastProvider } from "@junctura/health-ui";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError, createSettlement, decideClaim, downloadReportCsv, downloadSettlementCsv, getCallLog, getClaim, getClaims, getReport, getSettlements, verifyClaim } from "./api";
import { CallLog } from "./CallLog";
import { ClaimPage, outcomeMessage } from "./ClaimPage";
import { Queue, filterClaims } from "./Queue";
import { BatchVerify } from "./BatchVerify";
import { Reports } from "./Reports";
import { Settlements } from "./Settlements";
import { SessionProvider, type SessionValue } from "./session";
import type { Claim, ClaimDetail, ClaimStatus, QueueResult } from "./types";

vi.mock("./api", async importOriginal => ({
  ...(await importOriginal<typeof import("./api")>()),
  getClaims: vi.fn(), getClaim: vi.fn(), verifyClaim: vi.fn(), decideClaim: vi.fn(), getCallLog: vi.fn(), getReport: vi.fn(), downloadReportCsv: vi.fn(),
  getSettlements: vi.fn(), createSettlement: vi.fn(), downloadSettlementCsv: vi.fn(),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute("open"); };
});

const session = (extra: Partial<SessionValue> = {}): SessionValue => ({ settings: { issuer: "https://id.test", clientId: "c" }, facility: "Bệnh viện A", expire: () => {}, setCrumbs: () => {}, ...extra });
const wrap = (node: React.ReactNode, extra: Partial<SessionValue> = {}) => render(<ToastProvider><SessionProvider value={session(extra)}>{node}</SessionProvider></ToastProvider>);
afterEach(() => { cleanup(); vi.clearAllMocks(); history.replaceState(null, "", "/"); });

const claim = (patch: Partial<Claim> = {}): Claim => ({
  claimId: "HS-2026-00987", memberRef: "…1B2C3D", facility: "Bệnh viện A", requestedAmountVnd: 2450000, submittedAt: "2026-10-20T05:00:00.000Z",
  status: "new", dueAt: "2026-11-19T05:00:00.000Z", daysLeft: 10, overdue: false, approvedAmountVnd: null, settlementId: null, flags: [],
  check: null, decision: null, ...patch,
});
const queue = (items: Claim[]): QueueResult => {
  const counts: Record<ClaimStatus, number> = { new: 0, match: 0, mismatch: 0, explain: 0, accepted: 0, rejected: 0 };
  for (const item of items) counts[item.status]++;
  return { items, counts, open: items.filter(item => item.status !== "accepted" && item.status !== "rejected").length,
    overdue: items.filter(item => item.overdue).length, flagged: items.filter(item => item.flags.length > 0).length, slaDays: 30, unsettled: { count: 0, totalVnd: 0 }, facility: "Bệnh viện A", generatedAt: "2026-11-20T00:00:00.000Z" };
};
const detail = (item: Claim, history: ClaimDetail["history"] = [], related: ClaimDetail["related"] = []): ClaimDetail => ({ claim: item, history, related });
const checked = (matches: boolean, extra: Partial<Claim> = {}) => claim({ status: matches ? "match" : "mismatch", check: { matches, checkedAt: "2026-11-20T08:00:00.000Z" }, ...extra });

describe("queue", () => {
  const items = [
    claim({ claimId: "HS-1", requestedAmountVnd: 2_000_000 }),
    claim({ claimId: "HS-2", requestedAmountVnd: 7_000_000, status: "mismatch" }),
    claim({ claimId: "HS-3", requestedAmountVnd: 14_000_000, status: "accepted" }),
  ];

  it("filters by view, amount band, facility and claim code", () => {
    const base = { view: "all" as const, facility: "", amount: "" as const, query: "" };
    expect(filterClaims(items, { ...base, view: "open" }).map(c => c.claimId)).toEqual(["HS-1", "HS-2"]);
    expect(filterClaims(items, { ...base, view: "mismatch" }).map(c => c.claimId)).toEqual(["HS-2"]);
    expect(filterClaims(items, { ...base, view: "done" }).map(c => c.claimId)).toEqual(["HS-3"]);
    expect(filterClaims(items, { ...base, amount: "low" }).map(c => c.claimId)).toEqual(["HS-1"]);
    expect(filterClaims(items, { ...base, amount: "mid" }).map(c => c.claimId)).toEqual(["HS-2"]);
    expect(filterClaims(items, { ...base, amount: "high" }).map(c => c.claimId)).toEqual(["HS-3"]);
    expect(filterClaims(items, { ...base, query: " hs-2 " }).map(c => c.claimId)).toEqual(["HS-2"]);
    expect(filterClaims(items, { ...base, facility: "Nơi khác" })).toEqual([]);
  });

  it("shows the open claims first with the counts, and opens a claim on click", async () => {
    vi.mocked(getClaims).mockResolvedValue(queue(items));
    wrap(<Queue />);
    expect(await screen.findByText("HS-1")).toBeTruthy();
    expect(screen.getByText("HS-2")).toBeTruthy();
    expect(screen.queryByText("HS-3")).toBeNull();
    expect(screen.getByText("Chưa đối chiếu", { selector: "span *, span" })).toBeTruthy();
    await userEvent.click(screen.getByText("HS-2"));
    expect(location.pathname).toBe("/doi-chieu/HS-2");
  });

  it("switches to the decided claims", async () => {
    vi.mocked(getClaims).mockResolvedValue(queue(items));
    wrap(<Queue />);
    await screen.findByText("HS-1");
    await userEvent.click(screen.getByRole("radio", { name: /Đã quyết định/ }));
    expect(screen.getByText("HS-3")).toBeTruthy();
    expect(screen.queryByText("HS-1")).toBeNull();
  });

  it("says what to do when nothing is left, and when the server cannot be reached", async () => {
    vi.mocked(getClaims).mockResolvedValue(queue([claim({ status: "accepted" })]));
    wrap(<Queue />);
    expect(await screen.findByText("Không có hồ sơ nào")).toBeTruthy();
    cleanup();
    vi.mocked(getClaims).mockRejectedValue(new ApiError(503, "x", "store-unavailable"));
    wrap(<Queue />);
    expect(await screen.findByText(/Không tải được dữ liệu/)).toBeTruthy();
  });

  it("ends the session when the token is no longer accepted", async () => {
    vi.mocked(getClaims).mockRejectedValue(new ApiError(401, "x"));
    const expire = vi.fn();
    wrap(<Queue />, { expire });
    await waitFor(() => expect(expire).toHaveBeenCalled());
  });
});

describe("outcome messages", () => {
  it("never treats a missing answer as a match", () => {
    for (const status of ["no-consent", "unavailable", "not-authorized", "failed", "invalid-output"] as const) {
      const message = outcomeMessage({ status });
      expect(message.title).not.toBe("Khớp");
      expect(message.level).not.toBe("info");
    }
    expect(outcomeMessage({ status: "ok", matches: true, checkedAt: "x" }).title).toBe("Khớp");
    expect(outcomeMessage({ status: "ok", matches: false, checkedAt: "x" }).title).toBe("Không khớp");
  });
});

describe("claim page", () => {
  it("checks the claim and shows the yes or no, without any treatment detail", async () => {
    const unchecked = claim();
    vi.mocked(getClaim).mockResolvedValue(detail(unchecked));
    vi.mocked(verifyClaim).mockResolvedValue({ result: { status: "ok", matches: false, checkedAt: "2026-11-20T08:00:00.000Z" }, saved: true, claim: checked(false) });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    expect(await screen.findByText(/Chưa đối chiếu\. Junctura sẽ hỏi/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Đối chiếu ngay" }));
    expect(await screen.findByText("Không khớp", { selector: "h2, h3, p, div, strong, span" })).toBeTruthy();
    expect(vi.mocked(verifyClaim)).toHaveBeenCalledWith(expect.anything(), "HS-2026-00987");
    expect(screen.queryByText(/chẩn đoán:/i)).toBeNull();
  });

  it("explains a refusal for missing consent and leaves the claim unchecked", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(claim()));
    vi.mocked(verifyClaim).mockResolvedValue({ result: { status: "no-consent" }, saved: true, claim: claim() });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await userEvent.click(await screen.findByRole("button", { name: "Đối chiếu ngay" }));
    expect(await screen.findByText("Thành viên chưa đồng ý")).toBeTruthy();
    // The screen reloads in the background; the answer and the page must stay.
    await waitFor(() => expect(vi.mocked(getClaim)).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Thành viên chưa đồng ý")).toBeTruthy();
    expect(screen.queryByText("Khớp")).toBeNull();
  });

  it("keeps the reason the person typed when the claim is checked", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(claim()));
    vi.mocked(verifyClaim).mockResolvedValue({ result: { status: "ok", matches: true, checkedAt: "x" }, saved: true, claim: checked(true) });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await userEvent.type(await screen.findByLabelText(/Lý do/), "Đang soạn lý do");
    await userEvent.click(screen.getByRole("button", { name: "Đối chiếu ngay" }));
    await waitFor(() => expect(vi.mocked(getClaim)).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText(/Lý do/) as HTMLTextAreaElement).value).toBe("Đang soạn lý do");
  });

  it("warns when a result could not be saved", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(claim()));
    vi.mocked(verifyClaim).mockResolvedValue({ result: { status: "ok", matches: true, checkedAt: "x" }, saved: false, claim: claim() });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await userEvent.click(await screen.findByRole("button", { name: "Đối chiếu ngay" }));
    expect(await screen.findByText("Chưa lưu được kết quả")).toBeTruthy();
  });

  it("will not accept a claim that has not matched, but allows rejecting it with a reason", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(checked(false)));
    vi.mocked(decideClaim).mockResolvedValue({ claim: checked(false, { status: "rejected" }) });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await screen.findByText("Quyết định");
    await userEvent.click(screen.getByRole("radio", { name: "Chấp nhận" }));
    expect(screen.getByText(/Chỉ chấp nhận được hồ sơ đã đối chiếu và khớp/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Chấp nhận" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Từ chối" }));
    const submit = screen.getByRole("button", { name: "Từ chối" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Lý do/), "ab");
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Lý do/), "c lệch số tiền");
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);
    expect(vi.mocked(decideClaim)).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/không sửa được/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Từ chối" }));
    await waitFor(() => expect(vi.mocked(decideClaim)).toHaveBeenCalledWith(expect.anything(), "HS-2026-00987", { kind: "rejected", reason: "abc lệch số tiền" }));
  });

  it("accepts a matching claim after confirmation", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(checked(true)));
    vi.mocked(decideClaim).mockResolvedValue({ claim: checked(true, { status: "accepted" }) });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await screen.findByText("Quyết định");
    await userEvent.click(screen.getByRole("radio", { name: "Chấp nhận" }));
    await userEvent.type(screen.getByLabelText(/Lý do/), "Khớp hồ sơ");
    await userEvent.click(screen.getByRole("button", { name: "Chấp nhận" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Chấp nhận" }));
    await waitFor(() => expect(vi.mocked(decideClaim)).toHaveBeenCalledWith(expect.anything(), "HS-2026-00987", { kind: "accepted", reason: "Khớp hồ sơ", approvedAmountVnd: 2450000 }));
  });

  it("shows a final decision read-only with the reason and offers the next claim", async () => {
    const done = checked(true, { status: "accepted", decision: { kind: "accepted", reason: "Khớp hồ sơ", at: "2026-11-20T09:00:00.000Z", assessorName: "Giám định viên Hùng" } });
    vi.mocked(getClaim).mockResolvedValue(detail(done, [{ type: "decision", at: "2026-11-20T09:00:00.000Z", kind: "accepted", reason: "Khớp hồ sơ", assessorName: "Giám định viên Hùng" }]));
    vi.mocked(getClaims).mockResolvedValue(queue([done, claim({ claimId: "HS-NEXT" })]));
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    expect(await screen.findByText(/Lý do: Khớp hồ sơ/)).toBeTruthy();
    expect(screen.getByText("Quyết định cuối cùng, không sửa được.")).toBeTruthy();
    expect(screen.queryByLabelText(/Lý do/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Đối chiếu ngay" })).toBeNull();
    expect(await screen.findByRole("button", { name: /Hồ sơ kế tiếp: HS-NEXT/ })).toBeTruthy();
  });

  it("says so when the claim does not exist", async () => {
    vi.mocked(getClaim).mockRejectedValue(new ApiError(404, "x", "unknown-claim"));
    wrap(<ClaimPage claimId="HS-NOPE" />);
    expect(await screen.findByText("Không tìm thấy hồ sơ")).toBeTruthy();
  });
});

describe("reports", () => {
  const report = {
    total: { claims: 3, checked: 2, mismatches: 1, mismatchRate: 50, acceptedVnd: 2450000, reducedVnd: 0, rejectedVnd: 3018000, openVnd: 9890000, overdue: 1, settledVnd: 0, unsettledVnd: 2450000 },
    months: [
      { month: "2026-09", claims: 2, checked: 1, mismatches: 1, mismatchRate: 100, acceptedVnd: 0, reducedVnd: 0, rejectedVnd: 3018000 },
      { month: "2026-10", claims: 1, checked: 1, mismatches: 0, mismatchRate: 0, acceptedVnd: 2450000, reducedVnd: 0, rejectedVnd: 0 },
    ],
    generatedAt: "2026-11-20T00:00:00.000Z",
  };

  it("shows totals, a chart with a text alternative and the monthly table", async () => {
    vi.mocked(getReport).mockResolvedValue(report);
    wrap(<Reports />);
    expect(await screen.findByRole("img", { name: /tháng 09\/2026 có 1, 1 không khớp/ })).toBeTruthy();
    expect(screen.getAllByText("Tỷ lệ không khớp").length).toBeGreaterThan(1);
    expect(screen.getByRole("table", { name: "Theo tháng gửi hồ sơ" })).toBeTruthy();
  });

  it("writes 'Chưa có' for the rate until a claim has been checked, and says when there are no claims", async () => {
    vi.mocked(getReport).mockResolvedValue({ ...report, total: { ...report.total, claims: 0, checked: 0, mismatches: 0, mismatchRate: null }, months: [] });
    wrap(<Reports />);
    expect(await screen.findByText("Chưa có hồ sơ nào")).toBeTruthy();
    expect(screen.getAllByText("Chưa có").length).toBeGreaterThan(0);
  });

  it("downloads the CSV, and tells the person when that fails", async () => {
    vi.mocked(getReport).mockResolvedValue(report);
    vi.mocked(downloadReportCsv).mockRejectedValue(new ApiError(503, "x"));
    wrap(<Reports />);
    await userEvent.click(await screen.findByRole("button", { name: /Tải CSV/ }));
    expect(await screen.findByText("Chưa tải được báo cáo. Hãy thử lại.")).toBeTruthy();
  });
});

describe("call log", () => {
  it("lists the calls with their outcome and a link to the claim, and never a result", async () => {
    vi.mocked(getCallLog).mockResolvedValue({ items: [
      { capability: "claim-verify", purpose: "claim_review", outcome: "no-consent", claimId: "HS-1", assessorName: "Giám định viên Hùng", at: "2026-11-20T09:00:00.000Z" },
      { capability: "claim-verify", purpose: "claim_review", outcome: "ok", claimId: "HS-2", assessor: "giamdinh", at: "2026-11-20T08:00:00.000Z" },
    ] });
    wrap(<CallLog />);
    expect(await screen.findByText("Chưa có đồng thuận")).toBeTruthy();
    expect(screen.getByText("Thành công")).toBeTruthy();
    expect(screen.getByRole("link", { name: "HS-1" }).getAttribute("href")).toBe("/doi-chieu/HS-1");
    expect(screen.queryByText("Khớp")).toBeNull();
  });
  it("says when there are no calls yet", async () => {
    vi.mocked(getCallLog).mockResolvedValue({ items: [] });
    wrap(<CallLog />);
    expect(await screen.findByText("Chưa có lần gọi nào")).toBeTruthy();
  });
});

describe("queue: due dates and flags", () => {
  const items = [
    claim({ claimId: "HS-LATE", overdue: true, daysLeft: -3, dueAt: "2026-11-01T00:00:00.000Z" }),
    claim({ claimId: "HS-FLAG", flags: [{ code: "repeat", count: 2, days: 30 }], dueAt: "2026-12-01T00:00:00.000Z" }),
    claim({ claimId: "HS-SOON", daysLeft: 2, dueAt: "2026-11-10T00:00:00.000Z" }),
    claim({ claimId: "HS-DONE", status: "accepted", daysLeft: null, flags: [{ code: "history", count: 1 }] }),
  ];

  it("filters the overdue and the flagged claims, and a decided claim is never flagged", () => {
    const base = { view: "all" as const, facility: "", amount: "" as const, query: "" };
    expect(filterClaims(items, { ...base, view: "overdue" }).map(c => c.claimId)).toEqual(["HS-LATE"]);
    expect(filterClaims(items, { ...base, view: "flagged" }).map(c => c.claimId)).toEqual(["HS-FLAG"]);
  });

  it("writes the time left in words, the soonest due first", async () => {
    vi.mocked(getClaims).mockResolvedValue(queue(items));
    wrap(<Queue />);
    expect(await screen.findByText("Quá hạn 3 ngày")).toBeTruthy();
    expect(screen.getByText("Còn 2 ngày")).toBeTruthy();
    expect(screen.getByText("Nhiều hồ sơ")).toBeTruthy();
    const ids = screen.getAllByRole("row").map(row => /HS-[A-Z]+/.exec(row.textContent ?? "")?.[0]).filter(Boolean);
    expect(ids).toEqual(["HS-LATE", "HS-SOON", "HS-FLAG"]);
  });
});

describe("claim page: flags, related claims and partial acceptance", () => {
  it("explains each flag in words and says it does not block the decision", async () => {
    const flagged = claim({ flags: [{ code: "repeat", count: 2, days: 30 }, { code: "high-amount", factor: 2 }] });
    vi.mocked(getClaim).mockResolvedValue(detail(flagged));
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    expect(await screen.findByText("Cần xem kỹ hồ sơ này")).toBeTruthy();
    expect(screen.getByText("Người này còn 2 hồ sơ khác trong vòng 30 ngày.")).toBeTruthy();
    expect(screen.getByText("Số tiền cao hơn 2 lần mức trung vị của các hồ sơ.")).toBeTruthy();
    expect(screen.getByText(/không chặn quyết định/)).toBeTruthy();
  });

  it("lists the member's other claims with a way to open them", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(claim(), [], [{ claimId: "HS-OTHER", submittedAt: "2026-10-01T00:00:00.000Z", requestedAmountVnd: 1000000, status: "mismatch", approvedAmountVnd: null }]));
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await userEvent.click(await screen.findByText("HS-OTHER"));
    expect(location.pathname).toBe("/doi-chieu/HS-OTHER");
  });

  it("accepts less than requested, never more, and names the reduction in the confirmation", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(checked(true)));
    vi.mocked(decideClaim).mockResolvedValue({ claim: checked(true, { status: "accepted" }) });
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await screen.findByText("Quyết định");
    await userEvent.click(screen.getByRole("radio", { name: "Chấp nhận" }));
    const amount = screen.getByLabelText(/Số tiền chấp nhận/) as HTMLInputElement;
    expect(amount.value).toBe("2450000");
    await userEvent.type(screen.getByLabelText(/Lý do/), "Trừ phần ngoài danh mục");
    await userEvent.clear(amount);
    await userEvent.type(amount, "2450001");
    expect(screen.getByText(/Nhập số nguyên từ 1 đến/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Chấp nhận" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(amount);
    await userEvent.type(amount, "2000000");
    expect(screen.getByText(/Giảm 450\.000 ₫ so với đề nghị/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Chấp nhận" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/đề nghị 2\.450\.000 ₫/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Chấp nhận" }));
    await waitFor(() => expect(vi.mocked(decideClaim)).toHaveBeenCalledWith(expect.anything(), "HS-2026-00987", { kind: "accepted", reason: "Trừ phần ngoài danh mục", approvedAmountVnd: 2000000 }));
  });

  it("does not ask for an amount when rejecting", async () => {
    vi.mocked(getClaim).mockResolvedValue(detail(checked(false)));
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    await screen.findByText("Quyết định");
    await userEvent.click(screen.getByRole("radio", { name: "Từ chối" }));
    expect(screen.queryByLabelText(/Số tiền chấp nhận/)).toBeNull();
  });

  it("shows the approved amount and the settlement of a decided claim", async () => {
    const done = checked(true, { status: "accepted", approvedAmountVnd: 2000000, settlementId: "QT-20261120-01", decision: { kind: "accepted", reason: "Khớp", at: "2026-11-20T09:00:00.000Z" } });
    vi.mocked(getClaim).mockResolvedValue(detail(done));
    vi.mocked(getClaims).mockResolvedValue(queue([done]));
    wrap(<ClaimPage claimId="HS-2026-00987" />);
    expect(await screen.findByText(/giảm 450\.000 ₫ so với đề nghị/)).toBeTruthy();
    expect(screen.getByText("Đã quyết toán trong đợt QT-20261120-01.")).toBeTruthy();
  });
});

describe("batch check", () => {
  const fresh = [claim({ claimId: "HS-A" }), claim({ claimId: "HS-B", submittedAt: "2026-10-01T00:00:00.000Z" }), claim({ claimId: "HS-C", status: "mismatch" })];

  it("checks only the unchecked claims, oldest first, and reports the tally", async () => {
    vi.mocked(verifyClaim)
      .mockResolvedValueOnce({ result: { status: "ok", matches: true, checkedAt: "x" }, saved: true, claim: claim() })
      .mockResolvedValueOnce({ result: { status: "no-consent" }, saved: true, claim: claim() });
    const done = vi.fn();
    wrap(<BatchVerify claims={fresh} onDone={done} />);
    await userEvent.click(screen.getByRole("button", { name: "Đối chiếu 2 hồ sơ chưa kiểm tra" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Bắt đầu đối chiếu" }));
    expect(await screen.findByText(/1 khớp, 0 không khớp, 1 chưa có đồng thuận, 0 lỗi/)).toBeTruthy();
    expect(vi.mocked(verifyClaim).mock.calls.map(call => call[1])).toEqual(["HS-B", "HS-A"]);
    expect(done).toHaveBeenCalled();
  });

  it("stops when Junctura cannot be reached instead of failing every claim", async () => {
    vi.mocked(verifyClaim).mockResolvedValue({ result: { status: "unavailable" }, saved: true, claim: claim() });
    wrap(<BatchVerify claims={fresh} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Đối chiếu 2 hồ sơ/ }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Bắt đầu đối chiếu" }));
    expect(await screen.findByText("Đối chiếu dừng giữa chừng")).toBeTruthy();
    expect(vi.mocked(verifyClaim)).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when every claim was checked", () => {
    wrap(<BatchVerify claims={[claim({ status: "match" })]} onDone={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("settlements", () => {
  const pending = { claimId: "HS-1", memberRef: "…1B2C3D", requestedAmountVnd: 2450000, approvedAmountVnd: 2000000, decidedAt: "2026-11-20T09:00:00.000Z" };
  const batch = { settlementId: "QT-20261101-01", count: 2, totalVnd: 5000000, createdByName: "Giám định viên Hùng", at: "2026-11-01T09:00:00.000Z" };

  it("lists the accepted claims waiting and the batches already made", async () => {
    vi.mocked(getSettlements).mockResolvedValue({ items: [batch], pending: { count: 1, totalVnd: 2000000, claims: [pending] } });
    wrap(<Settlements />);
    expect(await screen.findByText("HS-1")).toBeTruthy();
    expect(screen.getByText("QT-20261101-01")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Tải CSV/ }));
    await waitFor(() => expect(vi.mocked(downloadSettlementCsv)).toHaveBeenCalledWith(expect.anything(), "QT-20261101-01"));
  });

  it("makes a batch only after confirming what it contains and that it cannot be changed", async () => {
    vi.mocked(getSettlements).mockResolvedValue({ items: [], pending: { count: 1, totalVnd: 2000000, claims: [pending] } });
    vi.mocked(createSettlement).mockResolvedValue({ settlement: { ...batch, count: 1, totalVnd: 2000000 } });
    wrap(<Settlements />);
    await userEvent.click(await screen.findByRole("button", { name: "Lập đợt quyết toán" }));
    expect(vi.mocked(createSettlement)).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/không sửa được/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Lập đợt quyết toán" }));
    await waitFor(() => expect(vi.mocked(createSettlement)).toHaveBeenCalled());
  });

  it("disables the button and says what to do when nothing is waiting", async () => {
    vi.mocked(getSettlements).mockResolvedValue({ items: [], pending: { count: 0, totalVnd: 0, claims: [] } });
    wrap(<Settlements />);
    expect(await screen.findByText("Không có hồ sơ chờ quyết toán")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Lập đợt quyết toán" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Chưa có đợt quyết toán nào")).toBeTruthy();
  });
});
