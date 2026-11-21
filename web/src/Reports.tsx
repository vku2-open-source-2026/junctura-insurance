// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Card, DataTable, EmptyState, PageHeader, StatStrip, useToast, type Column } from "@junctura/health-ui";
import { Download } from "lucide-react";
import { useState } from "react";
import { downloadReportCsv, getReport } from "./api";
import { formatRate, formatVnd, monthLabel } from "./format";
import { MonthlyChart } from "./parts";
import { Remote, useRemote, useSession } from "./session";
import type { ReportResult } from "./types";

type Row = ReportResult["months"][number];

const COLUMNS: Column<Row>[] = [
  { key: "month", header: "Tháng", render: row => monthLabel(row.month), sortValue: row => row.month },
  { key: "claims", header: "Hồ sơ", align: "right", sortValue: row => row.claims },
  { key: "checked", header: "Đã đối chiếu", align: "right", sortValue: row => row.checked },
  { key: "mismatches", header: "Không khớp", align: "right", sortValue: row => row.mismatches },
  { key: "rate", header: "Tỷ lệ không khớp", align: "right", render: row => formatRate(row.mismatchRate), sortValue: row => row.mismatchRate ?? -1 },
  { key: "accepted", header: "Đã chấp nhận", align: "right", render: row => formatVnd(row.acceptedVnd), sortValue: row => row.acceptedVnd },
  { key: "reduced", header: "Giảm trừ", align: "right", render: row => formatVnd(row.reducedVnd), sortValue: row => row.reducedVnd },
  { key: "rejected", header: "Đã từ chối", align: "right", render: row => formatVnd(row.rejectedVnd), sortValue: row => row.rejectedVnd },
];

export function Reports() {
  const { settings, expire } = useSession();
  const { notify } = useToast();
  const { state, reload } = useRemote(signal => getReport(settings, signal), [settings]);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const blob = await downloadReportCsv(settings);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "bao-cao-giam-dinh.csv";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      if ((error as { status?: number }).status === 401) return expire();
      notify("Chưa tải được báo cáo. Hãy thử lại.", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Báo cáo giám định" description="Tỷ lệ không khớp theo tháng gửi, tiền đã chấp nhận (sau giảm trừ), đã từ chối, đã quyết toán và hồ sơ quá hạn."
        actions={<Button variant="secondary" loading={busy} icon={<Download aria-hidden className="size-4" />} onClick={() => void download()}>Tải CSV</Button>} />
      <Remote state={state} reload={reload}>{report => (
        <>
          <StatStrip items={[
            { label: "Hồ sơ", value: report.total.claims },
            { label: "Đã đối chiếu", value: report.total.checked },
            { label: "Tỷ lệ không khớp", value: formatRate(report.total.mismatchRate), tone: (report.total.mismatchRate ?? 0) > 0 ? "warn" : "neutral" },
            { label: "Đã chấp nhận", value: formatVnd(report.total.acceptedVnd), tone: "ok" },
            { label: "Đã từ chối", value: formatVnd(report.total.rejectedVnd), tone: report.total.rejectedVnd > 0 ? "danger" : "neutral" },
            { label: "Chưa quyết định", value: formatVnd(report.total.openVnd) },
            { label: "Giảm trừ khi chấp nhận", value: formatVnd(report.total.reducedVnd), tone: report.total.reducedVnd > 0 ? "warn" : "neutral" },
            { label: "Chờ quyết toán", value: formatVnd(report.total.unsettledVnd) },
            { label: "Đã quyết toán", value: formatVnd(report.total.settledVnd), tone: "ok" },
            { label: "Quá hạn xử lý", value: report.total.overdue, tone: report.total.overdue > 0 ? "danger" : "neutral" },
          ]} />
          {report.months.length === 0 ? (
            <Card><EmptyState title="Chưa có hồ sơ nào">Báo cáo xuất hiện khi hàng chờ có yêu cầu thanh toán.</EmptyState></Card>
          ) : (
            <>
              <Card title="Hồ sơ đã đối chiếu theo tháng"><MonthlyChart months={report.months} /></Card>
              <Card><DataTable caption="Theo tháng gửi hồ sơ" columns={COLUMNS} rows={report.months} rowKey={row => row.month} /></Card>
            </>
          )}
          <p className="text-sm text-muted">Tỷ lệ chỉ tính trên các hồ sơ đã đối chiếu. Báo cáo không có chẩn đoán hay chi tiết điều trị.</p>
        </>
      )}</Remote>
    </div>
  );
}
