// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { EmptyState, ErrorState, PermissionState, Skeleton } from "@junctura/health-ui";
import { createContext, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from "react";
import { ApiError } from "./api";
import type { OidcSettings } from "./auth";

export interface SessionValue { settings: OidcSettings; facility: string; expire: () => void; setCrumbs: (crumbs: string[]) => void }

const SessionContext = createContext<SessionValue | null>(null);
export const SessionProvider = SessionContext.Provider;
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

export type RemoteState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; forbidden: boolean };

/**
 * Loads data for a screen; a 401 ends the session, any other failure is shown with a retry.
 * `refresh` loads again in the background and keeps what is on screen (and what the person has
 * typed) until the new data arrives; `reload` starts over with the skeleton.
 */
export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>, deps: DependencyList) {
  const { expire } = useSession();
  const [state, setState] = useState<RemoteState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const silent = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const background = silent.current;
    silent.current = false;
    if (!background) setState({ status: "loading" });
    load(controller.signal).then(
      data => { if (!controller.signal.aborted) setState({ status: "ready", data }); },
      error => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) return expire();
        // A failed background refresh keeps the last good data instead of replacing it with an error.
        if (background) return;
        setState({ status: "error", forbidden: error instanceof ApiError && error.status === 403 });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return {
    state,
    reload: () => setAttempt(value => value + 1),
    refresh: () => { silent.current = true; setAttempt(value => value + 1); },
  };
}

/** Skeleton while loading, an error with retry on failure, the content when ready. */
export function Remote<T>({ state, reload, children }: { state: RemoteState<T>; reload: () => void; children: (data: T) => ReactNode }) {
  if (state.status === "loading") return <Skeleton lines={5} />;
  if (state.status === "error") {
    if (state.forbidden) {
      return <PermissionState title="Tài khoản này không phải giám định viên">Liên hệ quản trị Junctura để được cấp quyền xem nội dung này.</PermissionState>;
    }
    return <ErrorState onRetry={reload}>Không tải được dữ liệu từ máy chủ Bảo hiểm. Kiểm tra kết nối rồi thử lại.</ErrorState>;
  }
  return <>{children(state.data)}</>;
}

export const NotFound = () => <EmptyState title="Không tìm thấy trang">Địa chỉ này không có trong Bảo hiểm. Dùng thanh điều hướng bên trái.</EmptyState>;
