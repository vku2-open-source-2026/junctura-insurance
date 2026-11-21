// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { AppShell, Button, ErrorState, PermissionState, SignInPage, Skeleton, type NavGroup } from "@junctura/health-ui";
import { Banknote, BarChart3, ClipboardList, FileCheck2, Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, getConfig, getMe } from "./api";
import { buildLogoutUrl, clearSession, completeLogin, loadSession, startLogin } from "./auth";
import { CallLog } from "./CallLog";
import { ClaimPage } from "./ClaimPage";
import { Landing } from "./Landing";
import { NextClaim } from "./NextClaim";
import { Queue } from "./Queue";
import { Reports } from "./Reports";
import { Settlements } from "./Settlements";
import { navigate, useLocation } from "./router";
import { NotFound, SessionProvider } from "./session";
import type { Me, PublicConfig } from "./types";

type State =
  | { kind: "loading" }
  | { kind: "signed-out"; message?: string }
  | { kind: "forbidden" }
  | { kind: "ready"; me: Me }
  | { kind: "error" };

const ROLE_LABEL: Record<string, string> = { "claims-assessor": "Giám định viên" };

const NAV: NavGroup[] = [
  {
    label: "Bảo hiểm",
    items: [
      { id: "/", label: "Hàng chờ", icon: <Inbox aria-hidden className="size-4" /> },
      { id: "/doi-chieu", label: "Đối chiếu", icon: <FileCheck2 aria-hidden className="size-4" /> },
      { id: "/quyet-toan", label: "Quyết toán", icon: <Banknote aria-hidden className="size-4" /> },
      { id: "/bao-cao", label: "Báo cáo", icon: <BarChart3 aria-hidden className="size-4" /> },
      { id: "/nhat-ky", label: "Nhật ký Junctura", icon: <ClipboardList aria-hidden className="size-4" /> },
    ],
  },
];

const CLAIM_PATH = /^\/doi-chieu\/([^/]+)$/;

export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const { path } = useLocation();
  const [crumbs, setCrumbs] = useState<string[]>([]);
  const settings = useMemo(() => (config ? { issuer: config.issuer, clientId: config.clientId } : null), [config]);
  const expire = useCallback(() => { clearSession(); setState({ kind: "signed-out", message: "Phiên đăng nhập đã hết hạn." }); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await getConfig();
        if (cancelled) return;
        setConfig(loaded);
        const oidc = { issuer: loaded.issuer, clientId: loaded.clientId };
        let signedIn = loadSession() !== null;
        if (location.search.includes("code=") || location.search.includes("error=")) {
          try {
            signedIn = (await completeLogin(oidc, location.search)) !== null;
          } catch {
            history.replaceState(null, "", "/");
            return setState({ kind: "signed-out", message: "Đăng nhập không thành công. Hãy thử lại." });
          }
          history.replaceState(null, "", "/");
        }
        if (!signedIn) return setState({ kind: "signed-out" });
        setState({ kind: "ready", me: await getMe(oidc) });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState({ kind: "forbidden" });
        else if (error instanceof ApiError && error.status === 401) { clearSession(); setState({ kind: "signed-out" }); }
        else setState({ kind: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signOut = () => {
    if (!settings) return;
    const idToken = loadSession()?.idToken;
    clearSession();
    location.assign(buildLogoutUrl(settings, `${location.origin}/`, idToken));
  };

  if (state.kind === "loading") return <div className="mx-auto max-w-3xl p-8"><Skeleton lines={4} /></div>;
  if (state.kind === "error") return <div className="mx-auto max-w-xl p-8"><ErrorState onRetry={() => location.reload()}>Không kết nối được máy chủ Bảo hiểm hoặc Junctura. Thử lại sau.</ErrorState></div>;
  if (state.kind === "forbidden") {
    return <div className="mx-auto max-w-xl space-y-4 p-8"><PermissionState>Tài khoản này không thuộc nhân viên bảo hiểm nên không xem được.</PermissionState><Button variant="secondary" onClick={signOut}>Đăng xuất</Button></div>;
  }
  if (state.kind === "signed-out") {
    const signIn = () => settings && startLogin(settings);
    if (state.message) {
      return <SignInPage product="Insurance" subtitle="Đăng nhập bằng tài khoản Junctura của giám định viên." onSignIn={signIn} onBack={() => location.reload()} message={state.message}
        note={config ? `${config.facility}. Mật khẩu chỉ nhập trên trang của Junctura.` : undefined} />;
    }
    return <Landing facility={config?.facility} onSignIn={signIn} />;
  }

  const me = state.me;
  const claimMatch = CLAIM_PATH.exec(path);
  const page = path === "/"
    ? <Queue />
    : path === "/doi-chieu"
      ? <NextClaim />
      : claimMatch
        ? <ClaimPage claimId={decodeURIComponent(claimMatch[1])} />
        : path === "/quyet-toan"
          ? <Settlements />
          : path === "/bao-cao"
            ? <Reports />
            : path === "/nhat-ky"
              ? <CallLog />
              : <NotFound />;

  return (
    <SessionProvider value={{ settings: settings!, facility: config!.facility, expire, setCrumbs }}>
      <AppShell product="Insurance" nav={NAV} current={claimMatch ? "/doi-chieu" : path} onNavigate={navigate} breadcrumbs={crumbs}
        unit={{ name: "Junctura Insurance", stations: [{ id: "main", name: "Giám định bảo hiểm y tế" }] }}
        user={{ name: me.displayName, role: ROLE_LABEL[me.role] ?? me.role }} onSignOut={signOut}>
        {page}
      </AppShell>
    </SessionProvider>
  );
}
