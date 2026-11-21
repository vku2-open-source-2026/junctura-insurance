// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { Card, DataTable, EmptyState, PageHeader, SegmentedControl, SelectField, StatStrip, TextField, formatDate, type Column } from "@junctura/health-ui";
import { useMemo, useState } from "react";
import { getClaims } from "./api";
import { BatchVerify } from "./BatchVerify";
import { formatVnd, isFinal } from "./format";
import { DueBadge, FlagBadges, StatusBadge } from "./parts";
import { navigate } from "./router";
import { Remote, useRemote, useSession } from "./session";
import type { Claim } from "./types";

type View = "open" | "overdue" | "flagged" | "mismatch" | "done" | "all";
type Amount = "" | "low" | "mid" | "high";

const MILLION = 1_000_000;
const AMOUNT_BANDS: Record<Exclude<Amount, "">, (value: number) => boolean> = {
  low: value => value < 5 * MILLION,
  mid: value => value >= 5 * MILLION && value <= 10 * MILLION,
  high: value => value > 10 * MILLION,
};
const VIEWS: Record<View, (claim: Claim) => boolean> = {
  open: claim => !isFinal(claim.status),
  overdue: claim => claim.overdue,
  flagged: claim => claim.flags.length > 0 && !isFinal(claim.status),
  mismatch: claim => claim.status === "mismatch",
  done: claim => isFinal(claim.status),
  all: () => true,
};

/** Narrows the queue by view, facility, amount band and a search on the claim code. */
export function filterClaims(claims: Claim[], { view, facility, amount, query }: { view: View; facility: string; amount: Amount; query: string }): Claim[] {
  const needle = query.trim().toLowerCase();
  return claims.filter(claim => VIEWS[view](claim)
    && (facility === "" || claim.facility === facility)
    && (amount === "" || AMOUNT_BANDS[amount](claim.requestedAmountVnd))
    && (needle === "" || claim.claimId.toLowerCase().includes(needle)));
}

const COLUMNS: Column<Claim>[] = [
  { key: "claimId", header: "Mã hồ sơ", mono: true, sortValue: row => row.claimId },
  { key: "member", header: "Thành viên", render: row => <span className="font-mono text-sm">{row.memberRef}</span> },
  { key: "facility", header: "Cơ sở điều trị", sortValue: row => row.facility },
  { key: "amount", header: "Số tiền đề nghị", align: "right", render: row => formatVnd(row.requestedAmountVnd), sortValue: row => row.requestedAmountVnd },
  { key: "submittedAt", header: "Ngày gửi", render: row => formatDate(row.submittedAt), sortValue: row => Date.parse(row.submittedAt) },
  { key: "due", header: "Hạn xử lý", render: row => <DueBadge claim={row} />, sortValue: row => (row.daysLeft === null ? Number.MAX_SAFE_INTEGER : row.daysLeft) },
  { key: "flags", header: "Cần xem kỹ", render: row => <FlagBadges flags={isFinal(row.status) ? [] : row.flags} />, sortValue: row => (isFinal(row.status) ? 0 : row.flags.length) },
  { key: "status", header: "Trạng thái", render: row => <StatusBadge status={row.status} />, sortValue: row => row.status },
];

export function Queue() {
  const { settings } = useSession();
  const { state, reload } = useRemote(signal => getClaims(settings, signal), [settings]);
  const [view, setView] = useState<View>("open");
  const [facility, setFacility] = useState("");
  const [amount, setAmount] = useState<Amount>("");
  const [query, setQuery] = useState("");
  const data = state.status === "ready" ? state.data : null;
  const facilities = useMemo(() => [...new Set((data?.items ?? []).map(claim => claim.facility))].sort((a, b) => a.localeCompare(b, "vi")), [data]);
  // Work comes first where it is due first; the finished and the full list keep the newest on top.
  const rows = useMemo(() => {
    const found = filterClaims(data?.items ?? [], { view, facility, amount, query });
    return view === "done" || view === "all" ? found : [...found].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  }, [data, view, facility, amount, query]);

  return (
    <div className="space-y-6">
      <PageHeader title="Hàng chờ giám định" description="Yêu cầu thanh toán nhận được. Mở một hồ sơ để đối chiếu với cơ sở điều trị và ghi quyết định." />
      <Remote state={state} reload={reload}>{queue => (
        <>
          <StatStrip items={[
            { label: "Cần xử lý", value: queue.open },
            { label: `Quá hạn (${queue.slaDays} ngày)`, value: queue.overdue, tone: queue.overdue > 0 ? "danger" : "neutral" },
            { label: "Cần xem kỹ", value: queue.flagged, tone: queue.flagged > 0 ? "warn" : "neutral" },
            { label: "Chưa đối chiếu", value: queue.counts.new },
            { label: "Không khớp", value: queue.counts.mismatch, tone: queue.counts.mismatch > 0 ? "warn" : "neutral" },
            { label: "Đã quyết định", value: queue.counts.accepted + queue.counts.rejected, tone: "ok" },
          ]} />
          <BatchVerify claims={queue.items} onDone={reload} />
          <div className="flex flex-wrap items-end gap-4">
            <SegmentedControl label="Hiển thị" value={view} onChange={setView} options={[
              { value: "open", label: "Cần xử lý", count: queue.open },
              { value: "overdue", label: "Quá hạn", count: queue.overdue },
              { value: "flagged", label: "Cần xem kỹ", count: queue.flagged },
              { value: "mismatch", label: "Không khớp", count: queue.counts.mismatch },
              { value: "done", label: "Đã quyết định", count: queue.counts.accepted + queue.counts.rejected },
              { value: "all", label: "Tất cả", count: queue.items.length },
            ]} />
            <div className="w-56"><TextField label="Tìm theo mã hồ sơ" value={query} onChange={event => setQuery(event.target.value)} placeholder="HS-2026-00987" /></div>
            {facilities.length > 1 && (
              <div className="min-w-56"><SelectField label="Cơ sở điều trị" value={facility} onChange={event => setFacility(event.target.value)} options={[{ value: "", label: "Tất cả" }, ...facilities.map(name => ({ value: name, label: name }))]} /></div>
            )}
            <div className="min-w-48"><SelectField label="Số tiền" value={amount} onChange={event => setAmount(event.target.value as Amount)} options={[
              { value: "", label: "Tất cả" }, { value: "low", label: "Dưới 5 triệu" }, { value: "mid", label: "5 đến 10 triệu" }, { value: "high", label: "Trên 10 triệu" },
            ]} /></div>
          </div>
          <Card>
            <DataTable caption="Yêu cầu thanh toán" columns={COLUMNS} rows={rows} rowKey={row => row.claimId} onRowClick={row => navigate(`/doi-chieu/${encodeURIComponent(row.claimId)}`)}
              empty={<EmptyState title="Không có hồ sơ nào">{view === "open" ? "Mọi hồ sơ đã có quyết định. Xem tab Đã quyết định hoặc Báo cáo." : view === "overdue" ? "Không có hồ sơ nào quá hạn." : "Không có hồ sơ khớp bộ lọc. Thử bỏ bớt điều kiện."}</EmptyState>} />
          </Card>
        </>
      )}</Remote>
    </div>
  );
}
