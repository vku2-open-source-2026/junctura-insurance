// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INSURANCE_APP = "junctura-insurance";
const DEFAULT_FACILITY = "Cơ sở điều trị";
const DAY = 86_400_000;

const readJson = (healthDir, file) => JSON.parse(readFileSync(resolve(healthDir, "seed/data", file), "utf8"));

/**
 * Loads what the insurer owns from a junctura-health checkout: its staff and the payment
 * requests it received. Treatment data is never read from a seed; the only answer about
 * it is the yes/no that Junctura returns for each request.
 */
export function loadInsuranceData({ healthDir }) {
  let facility = DEFAULT_FACILITY;
  try {
    const name = readJson(healthDir, "hospital.json").facility;
    if (typeof name === "string" && name.trim() !== "") facility = name.trim();
  } catch {
    // The facility name is a label only; the queue works without it.
  }
  return buildInsuranceData({ accounts: readJson(healthDir, "accounts.json"), requests: readJson(healthDir, "insurance.json"), facility, today: new Date() });
}

/**
 * `today` moves the demo dates forward by whole days so the newest request is as recent as the
 * seed meant it to be on its reference date; without it the dates are used as they are.
 */
export function buildInsuranceData({ accounts, requests, facility = DEFAULT_FACILITY, today }) {
  const reference = Date.parse(requests.referenceDate);
  const shift = today && Number.isFinite(reference) ? Math.max(0, Math.floor((today.getTime() - reference) / DAY)) * DAY : 0;
  // Staff are matched by username, which stays stable even if the identity provider re-issues subjects.
  const staff = new Map(accounts.users.filter(user => user.app === INSURANCE_APP).map(user => [user.username, user]));
  const claims = new Map();
  for (const request of requests.claimRequests ?? []) {
    if (typeof request?.claimId !== "string" || typeof request.subject !== "string" || !Number.isInteger(request.requestedAmountVnd)) continue;
    claims.set(request.claimId, Object.freeze({
      claimId: request.claimId,
      subject: request.subject,
      requestedAmountVnd: request.requestedAmountVnd,
      submittedAt: shift === 0 ? request.submittedAt : new Date(Date.parse(request.submittedAt) + shift).toISOString(),
    }));
  }
  return { facility, staff, claims };
}
