// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { freshAccessToken, type OidcSettings } from "./auth";
import type { CallLogResult, Claim, ClaimDetail, DecisionKind, Me, PublicConfig, QueueResult, ReportResult, Settlement, SettlementsResult, VerifyResult } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

interface RequestOptions { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal }

async function authHeaders(settings?: OidcSettings): Promise<Record<string, string>> {
  if (!settings) return {};
  const token = await freshAccessToken(settings);
  if (!token) throw new ApiError(401, "unauthenticated", "unauthenticated");
  return { authorization: `Bearer ${token}` };
}

async function failed(response: Response): Promise<ApiError> {
  let code: string | undefined;
  try { code = ((await response.json()) as { error?: string }).error; } catch { /* the body is not JSON */ }
  return new ApiError(response.status, code ?? `request failed (${response.status})`, code);
}

async function request<T>(path: string, settings?: OidcSettings, options: RequestOptions = {}): Promise<T> {
  const headers = await authHeaders(settings);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, { method: options.method ?? "GET", headers, body, signal: options.signal });
  if (!response.ok) throw await failed(response);
  return response.json() as Promise<T>;
}

const claimPath = (claimId: string) => `/api/claims/${encodeURIComponent(claimId)}`;

export const getConfig = () => request<PublicConfig>("/api/config");
export const getMe = (settings: OidcSettings) => request<Me>("/api/me", settings);
export const getClaims = (settings: OidcSettings, signal?: AbortSignal) => request<QueueResult>("/api/claims", settings, { signal });
export const getClaim = (settings: OidcSettings, claimId: string, signal?: AbortSignal) => request<ClaimDetail>(claimPath(claimId), settings, { signal });
export const verifyClaim = (settings: OidcSettings, claimId: string) => request<VerifyResult>(`${claimPath(claimId)}/verify`, settings, { method: "POST" });
export const decideClaim = (settings: OidcSettings, claimId: string, input: { kind: DecisionKind; reason: string; approvedAmountVnd?: number }) =>
  request<{ claim: Claim }>(`${claimPath(claimId)}/decision`, settings, { method: "POST", body: input });
export const getCallLog = (settings: OidcSettings, signal?: AbortSignal) => request<CallLogResult>("/api/call-log", settings, { signal });
export const getReport = (settings: OidcSettings, signal?: AbortSignal) => request<ReportResult>("/api/report", settings, { signal });
export const downloadReportCsv = async (settings: OidcSettings): Promise<Blob> => {
  const response = await fetch("/api/report.csv", { headers: await authHeaders(settings) });
  if (!response.ok) throw await failed(response);
  return response.blob();
};
export const getSettlements = (settings: OidcSettings, signal?: AbortSignal) => request<SettlementsResult>("/api/settlements", settings, { signal });
export const createSettlement = (settings: OidcSettings) => request<{ settlement: Settlement }>("/api/settlements", settings, { method: "POST", body: {} });
export const downloadSettlementCsv = async (settings: OidcSettings, settlementId: string): Promise<Blob> => {
  const response = await fetch(`/api/settlements/${encodeURIComponent(settlementId)}/csv`, { headers: await authHeaders(settings) });
  if (!response.ok) throw await failed(response);
  return response.blob();
};
