// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, EmptyState, Skeleton } from "@junctura/health-ui";
import { useEffect } from "react";
import { getClaims } from "./api";
import { nextOpenClaim } from "./format";
import { Link, navigate } from "./router";
import { Remote, useRemote, useSession } from "./session";

/** "Đối chiếu" in the menu: goes straight to the next claim that still needs work. */
export function NextClaim() {
  const { settings } = useSession();
  const { state, reload } = useRemote(signal => getClaims(settings, signal), [settings]);
  const next = state.status === "ready" ? nextOpenClaim(state.data.items) : null;
  useEffect(() => {
    // Replace, so Back does not land on this redirect again.
    if (next) navigate(`/doi-chieu/${encodeURIComponent(next.claimId)}`, true);
  }, [next]);
  return (
    <Remote state={state} reload={reload}>{() => next ? <Skeleton lines={3} /> : (
      <EmptyState title="Không còn hồ sơ cần xử lý" action={<Link to="/"><Button variant="secondary">Về hàng chờ</Button></Link>}>Mọi yêu cầu thanh toán đã có quyết định.</EmptyState>
    )}</Remote>
  );
}
