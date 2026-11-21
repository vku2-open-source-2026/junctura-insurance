// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Card, DataTable, EmptyState, PageHeader, formatDateTime, type Column } from "@junctura/health-ui";
import { getCallLog } from "./api";
import { OUTCOME } from "./format";
import { Link } from "./router";
import { Remote, useRemote, useSession } from "./session";
import type { CallLogItem } from "./types";

const CAPABILITY: Record<string, string> = { "claim-verify": "Đối chiếu chi phí điều trị" };
const PURPOSE: Record<string, string> = { claim_review: "Giám định chi phí" };

const COLUMNS: Column<CallLogItem>[] = [
  { key: "at", header: "Thời gian", render: row => formatDateTime(row.at), sortValue: row => Date.parse(row.at) },
  { key: "capability", header: "Năng lực", render: row => CAPABILITY[row.capability] ?? row.capability },
  { key: "purpose", header: "Mục đích", render: row => PURPOSE[row.purpose] ?? row.purpose },
  { key: "claimId", header: "Hồ sơ", mono: true, render: row => <Link to={`/doi-chieu/${encodeURIComponent(row.claimId)}`} className="text-brand underline">{row.claimId}</Link>, sortValue: row => row.claimId },
  { key: "assessor", header: "Giám định viên", render: row => row.assessorName ?? row.assessor ?? "—" },
  { key: "outcome", header: "Kết quả", render: row => <Badge tone={OUTCOME[row.outcome]?.tone ?? "neutral"}>{OUTCOME[row.outcome]?.label ?? row.outcome}</Badge>, sortValue: row => row.outcome },
];

export function CallLog() {
  const { settings } = useSession();
  const { state, reload } = useRemote(signal => getCallLog(settings, signal), [settings]);
  return (
    <div className="space-y-6">
      <PageHeader title="Nhật ký Junctura" description="Các lần Bảo hiểm gọi Junctura để đối chiếu hồ sơ. Nhật ký chỉ ghi lần gọi, không có chẩn đoán, chi tiết điều trị hay kết quả khớp." />
      <Remote state={state} reload={reload}>{({ items }) => (
        <Card>
          <DataTable caption="Các lần gọi Junctura" columns={COLUMNS} rows={items} rowKey={row => `${row.at}-${row.claimId}`}
            empty={<EmptyState title="Chưa có lần gọi nào">Mỗi lần bạn bấm Đối chiếu trên một hồ sơ sẽ được ghi lại ở đây.</EmptyState>} />
        </Card>
      )}</Remote>
    </div>
  );
}
