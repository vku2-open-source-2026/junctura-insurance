// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AlertBanner, Button, ConfirmDialog } from "@junctura/health-ui";
import { ListChecks } from "lucide-react";
import { useRef, useState } from "react";
import { ApiError, verifyClaim } from "./api";
import { useSession } from "./session";
import type { Claim } from "./types";

/** At most this many claims are checked in one go, so one click cannot flood Junctura. */
export const BATCH_LIMIT = 25;

interface Tally { match: number; mismatch: number; noConsent: number; failed: number }
const EMPTY: Tally = { match: 0, mismatch: 0, noConsent: 0, failed: 0 };

/**
 * Checks the claims that were never checked, one after another, oldest first. It stops when
 * Junctura cannot be reached or refuses the application, because every next call would fail too.
 */
export function BatchVerify({ claims, onDone }: { claims: Claim[]; onDone: () => void }) {
  const { settings, expire } = useSession();
  const batch = [...claims].filter(claim => claim.status === "new").sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt)).slice(0, BATCH_LIMIT);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [tally, setTally] = useState<Tally | null>(null);
  const [stopped, setStopped] = useState<"unavailable" | "not-authorized" | "cancelled" | null>(null);
  const cancel = useRef(false);

  const run = async () => {
    setConfirming(false);
    setRunning(true);
    setStopped(null);
    cancel.current = false;
    const result: Tally = { ...EMPTY };
    const todo = batch;
    setProgress({ done: 0, total: todo.length });
    setTally(result);
    let reason: typeof stopped = null;
    for (const [index, claim] of todo.entries()) {
      if (cancel.current) { reason = "cancelled"; break; }
      try {
        const answer = (await verifyClaim(settings, claim.claimId)).result;
        if (answer.status === "ok") result[answer.matches ? "match" : "mismatch"]++;
        else if (answer.status === "no-consent") result.noConsent++;
        else if (answer.status === "unavailable" || answer.status === "not-authorized") { reason = answer.status; break; }
        else result.failed++;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return expire();
        result.failed++;
      }
      setProgress({ done: index + 1, total: todo.length });
      setTally({ ...result });
    }
    setStopped(reason);
    setRunning(false);
    onDone();
  };

  if (batch.length === 0 && !running && !tally) return null;
  const finished = tally !== null && !running;
  return (
    <div className="space-y-3">
      {!running && batch.length > 0 && (
        <Button variant="secondary" icon={<ListChecks aria-hidden className="size-4" />} onClick={() => setConfirming(true)}>Đối chiếu {batch.length} hồ sơ chưa kiểm tra</Button>
      )}
      {running && (
        <div className="space-y-2" role="status">
          <label className="block text-base text-ink" htmlFor="batch-progress">Đang đối chiếu {progress.done}/{progress.total} hồ sơ</label>
          <progress id="batch-progress" className="h-2 w-full max-w-md" value={progress.done} max={progress.total} />
          <div><Button variant="secondary" onClick={() => { cancel.current = true; }}>Dừng</Button></div>
        </div>
      )}
      {finished && tally && (
        <AlertBanner level={stopped === "unavailable" || stopped === "not-authorized" ? "warning" : "info"} title={stopped === "cancelled" ? "Đã dừng đối chiếu" : stopped ? "Đối chiếu dừng giữa chừng" : "Đã đối chiếu xong"}>
          {tally.match} khớp, {tally.mismatch} không khớp, {tally.noConsent} chưa có đồng thuận, {tally.failed} lỗi.
          {stopped === "unavailable" && " Chưa kết nối được Junctura hoặc cơ sở điều trị. Thử lại sau."}
          {stopped === "not-authorized" && " Junctura từ chối ứng dụng này. Liên hệ quản trị Junctura."}
        </AlertBanner>
      )}
      <ConfirmDialog open={confirming} title={`Đối chiếu ${batch.length} hồ sơ chưa kiểm tra?`} confirmLabel="Bắt đầu đối chiếu" onCancel={() => setConfirming(false)} onConfirm={() => void run()}
        description={<>Junctura sẽ hỏi cơ sở điều trị từng hồ sơ, lần lượt từ hồ sơ cũ nhất, và chỉ trả lời khớp hoặc không khớp. Hồ sơ nào thành viên chưa đồng ý sẽ được báo riêng. Mỗi lần hỏi được ghi vào nhật ký. Mỗi lượt tối đa {BATCH_LIMIT} hồ sơ.</>} />
    </div>
  );
}
