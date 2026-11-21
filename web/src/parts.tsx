// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge } from "@junctura/health-ui";
import { CheckCircle2, CircleDashed, CircleHelp, CircleX, Clock, FileQuestion, Flag as FlagIcon, XCircle } from "lucide-react";
import { FLAG_SHORT, STATUS, dueSoon, dueText, flagText, monthLabel } from "./format";
import type { Claim, ClaimStatus, Flag, ReportResult } from "./types";

const ICON: Record<ClaimStatus, typeof CheckCircle2> = {
  new: CircleDashed, match: CheckCircle2, mismatch: CircleX, explain: FileQuestion, accepted: CheckCircle2, rejected: XCircle,
};

/** Colour never carries the status alone: every badge has an icon and a word. */
export function StatusBadge({ status }: { status: ClaimStatus }) {
  const Icon = ICON[status] ?? CircleHelp;
  return <Badge tone={STATUS[status].tone} icon={<Icon aria-hidden className="size-3.5" />}>{STATUS[status].label}</Badge>;
}

/** Checked claims per month, with the mismatched part marked; the table next to it holds the same numbers. */
export function MonthlyChart({ months }: { months: ReportResult["months"] }) {
  const max = Math.max(1, ...months.map(row => row.checked));
  return (
    <figure className="space-y-3">
      <div role="img" aria-label={`Hồ sơ đã đối chiếu theo tháng: ${months.map(row => `tháng ${monthLabel(row.month)} có ${row.checked}, ${row.mismatches} không khớp`).join("; ")}.`} className="flex h-36 items-end gap-3">
        {months.map(row => (
          <div key={row.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-xs text-muted">{row.checked}</span>
            <div className="flex w-full max-w-14 flex-col-reverse overflow-hidden rounded-t-md bg-line" style={{ height: `${row.checked === 0 ? 3 : Math.max(8, Math.round((row.checked / max) * 100))}%` }}>
              {row.checked > 0 && <div className="bg-brand" style={{ height: `${((row.checked - row.mismatches) / row.checked) * 100}%` }} />}
              {row.mismatches > 0 && <div className="bg-warn" style={{ height: `${(row.mismatches / row.checked) * 100}%` }} />}
            </div>
            <span className="text-xs text-muted">{monthLabel(row.month)}</span>
          </div>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-brand" />Khớp</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-warn" />Không khớp</span>
      </figcaption>
    </figure>
  );
}


/** The time left to handle a claim: a word and an icon, with colour only as a second signal. */
export function DueBadge({ claim }: { claim: Pick<Claim, "daysLeft" | "overdue"> }) {
  const text = dueText(claim);
  if (text === null) return <span className="text-muted">—</span>;
  const tone = claim.overdue ? "danger" : dueSoon(claim) ? "warn" : "neutral";
  return <Badge tone={tone} icon={<Clock aria-hidden className="size-3.5" />}>{text}</Badge>;
}

/** Compact flags for a table row; the sentences are on the claim page. */
export function FlagBadges({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map(flag => <Badge key={flag.code} tone="warn" icon={<FlagIcon aria-hidden className="size-3.5" />}>{FLAG_SHORT[flag.code]}</Badge>)}
    </span>
  );
}

export const FlagSentences = ({ flags }: { flags: Flag[] }) => (
  <ul className="space-y-1.5 text-base text-ink">
    {flags.map(flag => <li key={flag.code} className="flex gap-2"><FlagIcon aria-hidden className="mt-1 size-4 shrink-0 text-warn" />{flagText(flag)}</li>)}
  </ul>
);
