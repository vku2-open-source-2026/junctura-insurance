// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Card, ConfirmDialog, DataTable, EmptyState, PageHeader, StatStrip, formatDate, formatDateTime, useToast, type Column } from "@junctura/health-ui";
import { Banknote, Download } from "lucide-react";
import { useState } from "react";
import { ApiError, createSettlement, downloadSettlementCsv, getSettlements } from "./api";
import { formatVnd } from "./format";
import { navigate } from "./router";
import { Remote, useRemote, useSession } from "./session";
import type { PendingClaim, Settlement } from "./types";

const PENDING_COLUMNS: Column<PendingClaim>[] = [
  { key: "claimId", header: "Mã hồ sơ", mono: true, sortValue: row => row.claimId },
  { key: "member", header: "Thành viên", render: row => <span className="font-mono text-sm">{row.memberRef}</span> },
  { key: "requested", header: "Số tiền đề nghị", align: "right", render: row => formatVnd(row.requestedAmountVnd), sortValue: row => row.requestedAmountVnd },
  { key: "approved", header: "Số tiền chấp nhận", align: "right", render: row => formatVnd(row.approvedAmountVnd), sortValue: row => row.approvedAmountVnd },
  { key: "decidedAt", header: "Ngày chấp nhận", render: row => (row.decidedAt ? formatDate(row.decidedAt) : "—"), sortValue: row => Date.parse(row.decidedAt ?? "") || 0 },
];

/** Accepted claims wait here until they are paid together in one batch. */
export function Settlements() {
  const { settings, expire } = useSession();
  const { notify } = useToast();
  const { state, reload, refresh } = useRemote(signal => getSettlements(settings, signal), [settings]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const settle = async () => {
    setBusy(true);
    try {
      const { settlement } = await createSettlement(settings);
      notify(`Đã lập đợt ${settlement.settlementId}: ${settlement.count} hồ sơ, ${formatVnd(settlement.totalVnd)}.`, "ok");
      setConfirming(false);
      refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expire();
      setConfirming(false);
      notify(error instanceof ApiError && error.code === "nothing-to-settle" ? "Không còn hồ sơ nào chờ quyết toán." : "Chưa lập được đợt quyết toán. Hãy thử lại.", "danger");
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const download = async (id: string) => {
    setDownloading(id);
    try {
      const blob = await downloadSettlementCsv(settings, id);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${id}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expire();
      notify("Chưa tải được tệp. Hãy thử lại.", "danger");
    } finally {
      setDownloading(null);
    }
  };

  const columns: Column<Settlement>[] = [
    { key: "settlementId", header: "Đợt", mono: true, sortValue: row => row.settlementId },
    { key: "at", header: "Lập lúc", render: row => formatDateTime(row.at), sortValue: row => Date.parse(row.at) },
    { key: "count", header: "Hồ sơ", align: "right", sortValue: row => row.count },
    { key: "total", header: "Tổng tiền", align: "right", render: row => formatVnd(row.totalVnd), sortValue: row => row.totalVnd },
    { key: "by", header: "Người lập", render: row => row.createdByName ?? "—" },
    { key: "csv", header: "Tệp", render: row => <Button variant="secondary" loading={downloading === row.settlementId} icon={<Download aria-hidden className="size-4" />} onClick={() => void download(row.settlementId)}>Tải CSV</Button> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Quyết toán" description="Gom các hồ sơ đã chấp nhận thành một đợt thanh toán và xuất tệp cho kế toán." />
      <Remote state={state} reload={reload}>{result => {
        const paid = result.items.reduce((sum, item) => sum + item.totalVnd, 0);
        return (
          <>
            <StatStrip items={[
              { label: "Chờ quyết toán", value: result.pending.count, tone: "neutral" },
              { label: "Tiền chờ quyết toán", value: formatVnd(result.pending.totalVnd) },
              { label: "Đợt đã lập", value: result.items.length },
              { label: "Tiền đã quyết toán", value: formatVnd(paid), tone: "ok" },
            ]} />
            <Card title="Hồ sơ chờ quyết toán" actions={<Button icon={<Banknote aria-hidden className="size-4" />} disabled={result.pending.count === 0} onClick={() => setConfirming(true)}>Lập đợt quyết toán</Button>}>
              <DataTable caption="Hồ sơ đã chấp nhận, chưa quyết toán" columns={PENDING_COLUMNS} rows={result.pending.claims} rowKey={row => row.claimId} onRowClick={row => navigate(`/doi-chieu/${encodeURIComponent(row.claimId)}`)}
                empty={<EmptyState title="Không có hồ sơ chờ quyết toán">Hồ sơ xuất hiện ở đây sau khi được chấp nhận.</EmptyState>} />
            </Card>
            <Card title="Các đợt đã lập">
              <DataTable caption="Các đợt quyết toán" columns={columns} rows={result.items} rowKey={row => row.settlementId}
                empty={<EmptyState title="Chưa có đợt quyết toán nào">Đợt đầu tiên được lập từ các hồ sơ đã chấp nhận.</EmptyState>} />
            </Card>
            <ConfirmDialog open={confirming} loading={busy} title={`Lập đợt quyết toán cho ${result.pending.count} hồ sơ?`} confirmLabel="Lập đợt quyết toán" onCancel={() => setConfirming(false)} onConfirm={() => void settle()}
              description={<>Gom <strong>{result.pending.count}</strong> hồ sơ đã chấp nhận, tổng <strong>{formatVnd(result.pending.totalVnd)}</strong>, vào một đợt. Các hồ sơ này không vào đợt khác được nữa và đợt đã lập <strong>không sửa được</strong>.</>} />
          </>
        );
      }}</Remote>
    </div>
  );
}
