// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AlertBanner, Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, PageHeader, SegmentedControl, TextAreaField, TextField, Timeline, formatDate, formatDateTime, useToast, type Column, type TimelineItem } from "@junctura/health-ui";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, decideClaim, getClaim, getClaims, verifyClaim } from "./api";
import { DECISION_LABEL, formatVnd, isFinal, nextOpenClaim } from "./format";
import { DueBadge, FlagSentences, StatusBadge } from "./parts";
import { Link, navigate } from "./router";
import { Remote, useRemote, useSession } from "./session";
import type { CheckOutcome, Claim, ClaimDetail, DecisionKind, RelatedClaim } from "./types";

export const REASON_MIN = 3;
export const REASON_MAX = 300;

/** What the assessor is told for each answer Junctura can give. */
export function outcomeMessage(outcome: CheckOutcome): { level: "info" | "notice" | "warning" | "critical"; title: string; text: string } {
  switch (outcome.status) {
    case "ok":
      return outcome.matches
        ? { level: "info", title: "Khớp", text: "Số tiền và hồ sơ khớp với cơ sở điều trị. Bạn có thể chấp nhận hồ sơ." }
        : { level: "warning", title: "Không khớp", text: "Hồ sơ hoặc số tiền khác với cơ sở điều trị. Bạn không nhận được lý do chi tiết; có thể từ chối hoặc yêu cầu giải trình." };
    case "no-consent":
      return { level: "warning", title: "Thành viên chưa đồng ý", text: "Thành viên chưa cho phép Bảo hiểm đối chiếu chi phí. Nhờ họ cấp đồng thuận trong MyHealth rồi đối chiếu lại." };
    case "unavailable":
      return { level: "notice", title: "Chưa đối chiếu được", text: "Chưa kết nối được Junctura hoặc cơ sở điều trị chưa cung cấp dịch vụ đối chiếu. Hồ sơ chưa bị coi là khớp hay không khớp. Thử lại sau." };
    case "not-authorized":
      return { level: "critical", title: "Chưa được cấp quyền", text: "Junctura từ chối lần đối chiếu này. Liên hệ quản trị Junctura." };
    default:
      return { level: "critical", title: "Đối chiếu không thành công", text: "Junctura trả lời không đúng hợp đồng hoặc gặp lỗi. Hồ sơ chưa được đối chiếu. Thử lại sau." };
  }
}

export function ClaimPage({ claimId }: { claimId: string }) {
  const { settings, setCrumbs } = useSession();
  const { state, reload: retry, refresh } = useRemote(async signal => {
    try {
      return await getClaim(settings, claimId, signal);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }, [settings, claimId]);
  useEffect(() => { setCrumbs(["Đối chiếu", claimId]); return () => setCrumbs([]); }, [claimId, setCrumbs]);

  return (
    <Remote state={state} reload={retry}>{detail => detail === null ? (
      <EmptyState title="Không tìm thấy hồ sơ" action={<Link to="/"><Button variant="secondary">Về hàng chờ</Button></Link>}>Mã hồ sơ {claimId} không có trong hàng chờ.</EmptyState>
    ) : <ClaimBody detail={detail} onChange={refresh} />}</Remote>
  );
}

function ClaimBody({ detail, onChange }: { detail: ClaimDetail; onChange: () => void }) {
  const { claim, history, related } = detail;
  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"><ArrowLeft aria-hidden className="size-4" />Hàng chờ</Link>
      <PageHeader title={claim.claimId} badges={<StatusBadge status={claim.status} />} description="Đối chiếu với cơ sở điều trị, rồi ghi quyết định kèm lý do." />
      {claim.flags.length > 0 && !isFinal(claim.status) && (
        <AlertBanner level="notice" title="Cần xem kỹ hồ sơ này">
          <FlagSentences flags={claim.flags} />
          <p className="mt-2 text-sm text-ink-2">Đây là gợi ý để bạn kiểm tra thêm, không phải kết luận và không chặn quyết định.</p>
        </AlertBanner>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <ClaimFacts claim={claim} />
        <CheckCard claim={claim} onChange={onChange} />
      </div>
      <DecisionCard claim={claim} onChange={onChange} />
      {related.length > 0 && <RelatedClaims related={related} />}
      <Card title="Lịch sử hồ sơ"><ClaimHistory history={history} submittedAt={claim.submittedAt} /></Card>
    </div>
  );
}

function ClaimFacts({ claim }: { claim: Claim }) {
  const rows: [string, string][] = [
    ["Thành viên", claim.memberRef],
    ["Cơ sở điều trị", claim.facility],
    ["Số tiền đề nghị", formatVnd(claim.requestedAmountVnd)],
    ["Ngày gửi", formatDate(claim.submittedAt)],
    ["Hạn xử lý", formatDate(claim.dueAt)],
    ...(claim.approvedAmountVnd !== null ? [["Số tiền chấp nhận", formatVnd(claim.approvedAmountVnd)] as [string, string]] : []),
    ...(claim.settlementId ? [["Đợt quyết toán", claim.settlementId] as [string, string]] : []),
  ];
  return (
    <Card title="Yêu cầu thanh toán">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
        {rows.map(([label, value]) => (<div key={label} className="contents"><dt className="text-muted">{label}</dt><dd className="font-medium text-ink">{value}{label === "Hạn xử lý" && !isFinal(claim.status) && <span className="ml-2 align-middle"><DueBadge claim={claim} /></span>}</dd></div>))}
      </dl>
      <p className="mt-4 flex gap-2 text-sm text-muted"><ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />Bảo hiểm không nhận chẩn đoán hay chi tiết điều trị, chỉ nhận câu trả lời khớp hoặc không khớp.</p>
    </Card>
  );
}

function CheckCard({ claim, onChange }: { claim: Claim; onChange: () => void }) {
  const { settings, expire } = useSession();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ value: CheckOutcome; saved: boolean } | null>(null);
  const [failure, setFailure] = useState(false);
  const decided = isFinal(claim.status);

  const run = async () => {
    setBusy(true);
    setFailure(false);
    try {
      const answer = await verifyClaim(settings, claim.claimId);
      setOutcome({ value: answer.result, saved: answer.saved });
      onChange();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expire();
      setOutcome(null);
      setFailure(true);
    } finally {
      setBusy(false);
    }
  };

  const shown = outcome ? outcomeMessage(outcome.value) : null;
  return (
    <Card title="Đối chiếu với cơ sở điều trị">
      <div className="space-y-4">
        {claim.check && !outcome && (
          <p className="text-base text-ink">
            Lần đối chiếu gần nhất: <strong>{claim.check.matches ? "Khớp" : "Không khớp"}</strong>, {formatDateTime(claim.check.checkedAt)}.
          </p>
        )}
        {!claim.check && !outcome && <p className="text-base text-ink-2">Chưa đối chiếu. Junctura sẽ hỏi cơ sở điều trị và chỉ trả lời khớp hoặc không khớp, nếu thành viên đã đồng ý.</p>}
        {shown && <AlertBanner level={shown.level} title={shown.title}>{shown.text}</AlertBanner>}
        {outcome && !outcome.saved && <AlertBanner level="warning" title="Chưa lưu được kết quả">Kết quả hiện ở trên nhưng chưa được lưu. Đối chiếu lại khi hệ thống lưu trữ hoạt động.</AlertBanner>}
        {failure && <AlertBanner level="critical" title="Chưa đối chiếu được">Không kết nối được máy chủ Bảo hiểm. Thử lại sau.</AlertBanner>}
        {!decided && <Button loading={busy} onClick={() => void run()}>{claim.check ? "Đối chiếu lại" : "Đối chiếu ngay"}</Button>}
      </div>
    </Card>
  );
}

function DecisionCard({ claim, onChange }: { claim: Claim; onChange: () => void }) {
  const { settings, expire } = useSession();
  const { notify } = useToast();
  const [kind, setKind] = useState<DecisionKind>("explain");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(String(claim.requestedAmountVnd));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<Claim | null | undefined>(undefined);

  useEffect(() => {
    if (!isFinal(claim.status)) return;
    let cancelled = false;
    getClaims(settings).then(queue => { if (!cancelled) setNext(nextOpenClaim(queue.items, claim.claimId)); }, () => { if (!cancelled) setNext(null); });
    return () => { cancelled = true; };
  }, [claim.status, claim.claimId, settings]);

  if (claim.decision && isFinal(claim.status)) {
    return (
      <Card title="Quyết định">
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink"><StatusBadge status={claim.status} />{formatDateTime(claim.decision.at)}{claim.decision.assessorName ? ` · ${claim.decision.assessorName}` : ""}</p>
          {claim.approvedAmountVnd !== null && (
            <p className="text-base text-ink">Số tiền chấp nhận: <strong>{formatVnd(claim.approvedAmountVnd)}</strong>
              {claim.approvedAmountVnd < claim.requestedAmountVnd && <> (giảm {formatVnd(claim.requestedAmountVnd - claim.approvedAmountVnd)} so với đề nghị)</>}</p>
          )}
          <p className="text-base text-ink-2">Lý do: {claim.decision.reason}</p>
          {claim.status === "accepted" && <p className="text-base text-ink-2">{claim.settlementId ? `Đã quyết toán trong đợt ${claim.settlementId}.` : "Đang chờ quyết toán."}</p>}
          <p className="text-sm text-muted">Quyết định cuối cùng, không sửa được.</p>
          {next !== undefined && (
            <div className="pt-2">{next
              ? <Button icon={<ArrowRight aria-hidden className="size-4" />} onClick={() => navigate(`/doi-chieu/${encodeURIComponent(next.claimId)}`)}>Hồ sơ kế tiếp: {next.claimId}</Button>
              : <p className="text-base text-ink">Không còn hồ sơ cần xử lý.</p>}</div>
          )}
        </div>
      </Card>
    );
  }

  const length = [...reason.trim()].length;
  const verified = claim.check?.matches === true;
  const blocked = kind === "accepted" && !verified;
  const approved = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : NaN;
  const amountError = kind === "accepted" && !(Number.isSafeInteger(approved) && approved >= 1 && approved <= claim.requestedAmountVnd)
    ? `Nhập số nguyên từ 1 đến ${formatVnd(claim.requestedAmountVnd)}.` : undefined;
  const reduced = kind === "accepted" && !amountError && approved < claim.requestedAmountVnd;
  const valid = length >= REASON_MIN && length <= REASON_MAX && !blocked && !amountError;

  const submit = async () => {
    setBusy(true);
    try {
      await decideClaim(settings, claim.claimId, { kind, reason: reason.trim(), ...(kind === "accepted" && { approvedAmountVnd: approved }) });
      notify(kind === "explain" ? "Đã gửi yêu cầu giải trình." : `Đã ${DECISION_LABEL[kind].toLowerCase()} hồ sơ ${claim.claimId}.`, "ok");
      setReason("");
      setConfirming(false);
      onChange();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) return expire();
      setConfirming(false);
      setError(failure instanceof ApiError && failure.code === "not-verified" ? "Chỉ chấp nhận được hồ sơ đã đối chiếu và khớp."
        : failure instanceof ApiError && failure.code === "already-decided" ? "Hồ sơ này đã có quyết định cuối cùng. Tải lại trang."
          : "Chưa lưu được quyết định. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Quyết định">
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); setError(null); if (valid) setConfirming(true); }}>
        <SegmentedControl label="Quyết định" value={kind} onChange={value => { setKind(value); setError(null); }} options={[
          { value: "accepted", label: DECISION_LABEL.accepted }, { value: "rejected", label: DECISION_LABEL.rejected }, { value: "explain", label: DECISION_LABEL.explain },
        ]} />
        {blocked && <p className="text-sm text-muted">Chỉ chấp nhận được hồ sơ đã đối chiếu và khớp. Hãy đối chiếu trước, hoặc chọn từ chối / yêu cầu giải trình.</p>}
        {kind === "accepted" && (
          <TextField label="Số tiền chấp nhận (₫)" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} error={amountError}
            hint={reduced ? `Giảm ${formatVnd(claim.requestedAmountVnd - approved)} so với đề nghị. Nêu lý do giảm ở ô bên dưới.` : "Để nguyên nếu chấp nhận toàn bộ số tiền đề nghị."} />
        )}
        <TextAreaField label="Lý do" required value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={REASON_MAX + 50}
          hint={`${length}/${REASON_MAX} ký tự. Lý do được lưu cùng quyết định.`}
          error={length > REASON_MAX ? `Tối đa ${REASON_MAX} ký tự.` : undefined} />
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!valid}>{DECISION_LABEL[kind]}</Button>
          {length > 0 && length < REASON_MIN && <Badge tone="neutral">Cần ít nhất {REASON_MIN} ký tự</Badge>}
        </div>
      </form>
      <ConfirmDialog open={confirming} danger={kind === "rejected"} loading={busy} title={`${DECISION_LABEL[kind]} hồ sơ ${claim.claimId}?`} confirmLabel={DECISION_LABEL[kind]}
        onCancel={() => setConfirming(false)} onConfirm={() => void submit()}
        description={kind === "explain"
          ? <>Yêu cầu cơ sở điều trị giải trình hồ sơ <strong>{claim.claimId}</strong> ({formatVnd(claim.requestedAmountVnd)}). Bạn vẫn có thể quyết định sau.</>
          : <>{DECISION_LABEL[kind]} hồ sơ <strong>{claim.claimId}</strong> với số tiền <strong>{formatVnd(kind === "accepted" ? approved : claim.requestedAmountVnd)}</strong>{reduced && <> (đề nghị {formatVnd(claim.requestedAmountVnd)})</>}. Đây là quyết định cuối cùng, <strong>không sửa được</strong>.</>} />
    </Card>
  );
}

function RelatedClaims({ related }: { related: RelatedClaim[] }) {
  const columns: Column<RelatedClaim>[] = [
    { key: "claimId", header: "Mã hồ sơ", mono: true, sortValue: row => row.claimId },
    { key: "date", header: "Ngày gửi", render: row => formatDate(row.submittedAt), sortValue: row => Date.parse(row.submittedAt) },
    { key: "amount", header: "Số tiền đề nghị", align: "right", render: row => formatVnd(row.requestedAmountVnd), sortValue: row => row.requestedAmountVnd },
    { key: "status", header: "Trạng thái", render: row => <StatusBadge status={row.status} />, sortValue: row => row.status },
  ];
  return (
    <Card title="Hồ sơ khác của người này" count={related.length}>
      <DataTable caption="Hồ sơ khác của cùng thành viên" columns={columns} rows={related} rowKey={row => row.claimId} onRowClick={row => navigate(`/doi-chieu/${encodeURIComponent(row.claimId)}`)} />
    </Card>
  );
}

export function ClaimHistory({ history, submittedAt }: { history: ClaimDetail["history"]; submittedAt: string }) {
  const items: TimelineItem[] = [
    ...history.map((entry, index): TimelineItem => entry.type === "check"
      ? { id: `c${index}`, time: entry.at, title: `Đối chiếu: ${entry.matches ? "khớp" : "không khớp"}`, description: entry.assessorName, tone: entry.matches ? "ok" : "warn" }
      : { id: `d${index}`, time: entry.at, title: DECISION_LABEL[entry.kind], description: `${entry.reason}${entry.assessorName ? ` · ${entry.assessorName}` : ""}`, tone: entry.kind === "accepted" ? "ok" : entry.kind === "rejected" ? "danger" : "brand" }),
    { id: "submitted", time: submittedAt, title: "Nhận yêu cầu thanh toán", tone: "neutral" },
  ];
  return <Timeline label="Lịch sử hồ sơ" items={items} />;
}
