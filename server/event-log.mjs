// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { listRecords, storeUnavailable } from "./records.mjs";

/**
 * An append-only collection on the Junctura record store. Only the listed fields are kept,
 * so nothing else a caller passes can end up stored.
 */
export function createEventLog({ client, collection, fields, key = "claimId" }) {
  const pick = source => Object.fromEntries(fields.map(field => [field, source?.[field]]).filter(([, value]) => value !== undefined));
  return Object.freeze({
    async add(entry) {
      const record = pick(entry);
      try {
        await client.createRecord(collection, record);
      } catch {
        throw storeUnavailable();
      }
      return record;
    },
    async list() {
      try {
        return (await listRecords(client, collection))
          .filter(entry => typeof entry.at === "string" && typeof entry[key] === "string")
          .map(pick)
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      } catch {
        throw storeUnavailable();
      }
    },
  });
}

/** Junctura calls this insurer made. Never holds treatment data: the answer is only yes or no. */
export const createCallLog = ({ client }) => createEventLog({
  client, collection: "call-log", fields: ["capability", "purpose", "outcome", "claimId", "assessor", "assessorName", "at"],
});

/** The newest yes/no match result per claim, kept so the queue can show it. */
export const createChecks = ({ client }) => createEventLog({
  client, collection: "checks", fields: ["claimId", "matches", "checkedAt", "assessor", "assessorName", "at"],
});

/** Decisions on claims: accepted, rejected or explanation requested, always with a reason. */
export const createDecisions = ({ client }) => createEventLog({
  client, collection: "decisions", fields: ["claimId", "kind", "reason", "amountVnd", "assessor", "assessorName", "at"],
});

/** Payment batches: the accepted claims paid together, with the total. */
export const createSettlements = ({ client }) => createEventLog({
  client, collection: "settlements", key: "settlementId",
  fields: ["settlementId", "claimIds", "count", "totalVnd", "createdBy", "createdByName", "at"],
});
