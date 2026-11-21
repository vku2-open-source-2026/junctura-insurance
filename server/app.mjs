// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { buildQueue, decisionBlocker, planSettlement, relatedClaims, validDecision } from "./claims.mjs";
import { AuthError } from "./jwt.mjs";
import { buildReport, reportCsv, settlementCsv } from "./report.mjs";

const MAX_BODY_BYTES = 4 * 1024;
const ASSESSOR_ROLE = "claims-assessor";
const CLAIM_ID = "[A-Za-z0-9_-]{1,64}";
const CLAIM_ROUTE = new RegExp(`^/api/claims/(${CLAIM_ID})(?:/(verify|decision))?$`);
const SETTLEMENT_CSV_ROUTE = /^\/api\/settlements\/(QT-\d{8}-\d{2,})\/csv$/;

const API_METHODS = new Map([
  ["/api/config", "GET, HEAD"],
  ["/api/me", "GET, HEAD"],
  ["/api/claims", "GET, HEAD"],
  ["/api/call-log", "GET, HEAD"],
  ["/api/settlements", "GET, HEAD, POST"],
  ["/api/report", "GET, HEAD"],
  ["/api/report.csv", "GET, HEAD"],
]);

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".ico": "image/x-icon", ".png": "image/png", ".txt": "text/plain; charset=utf-8",
};

const securityHeaders = config => ({
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": [
    "default-src 'self'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
    `connect-src 'self' ${new URL(config.issuer).origin}`, "img-src 'self' data:", "style-src 'self' 'unsafe-inline'",
  ].join("; "),
});

const isJsonRequest = req => {
  const value = req.headers["content-type"];
  return typeof value === "string" && value.split(";", 1)[0].trim().toLowerCase() === "application/json";
};

function readJsonBody(req) {
  return new Promise(resolve => {
    let settled = false;
    const settle = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume();
      settle({ status: 413 });
      return;
    }

    let size = 0;
    const chunks = [];
    req.on("data", chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settle({ status: 413 });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try {
        settle({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        settle({ status: 400 });
      }
    });
    req.on("error", () => settle({ status: 400 }));
  });
}


/**
 * Request handler of the Insurance server: a small JSON API behind Junctura sign-in plus the
 * built web UI. Only the claims assessors of this application get in; every other signed-in
 * person is refused. Treatment data never passes through here: the only thing Junctura
 * returns about a claim is whether it matches.
 */
export function createApp({ config, data, verifier, capabilities, callLog, checks, decisions, settlements, clock = () => new Date() }) {
  const base = securityHeaders(config);
  const slaDays = config.slaDays ?? 30;

  // Decisions and settlements read the stores and then write: one at a time, so two requests
  // cannot both accept the same claim or pay it twice.
  let writing = Promise.resolve();
  const exclusive = task => {
    const run = writing.then(task, task);
    writing = run.catch(() => {});
    return run;
  };

  const send = (res, status, body, headers = {}) => {
    const json = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(status, { ...base, "cache-control": "no-store", ...(json && { "content-type": "application/json; charset=utf-8" }), ...headers });
    res.end(json);
  };

  async function authenticate(req) {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    if (!match) throw new AuthError("sign in required");
    const claims = await verifier(match[1]);
    const user = data.staff.get(claims.preferred_username);
    return user ? { username: user.username, displayName: user.displayName, role: user.role } : null;
  }

  // Store failures only log an error code, never claim or member data.
  function storeFailure(res, error) {
    if (error?.status === 503) {
      console.error(error.code ?? "store-unavailable");
      return send(res, 503, { error: "store-unavailable" });
    }
    console.error(error?.code ?? "internal-error");
    return send(res, 500, { error: "internal-error" });
  }

  const stores = () => Promise.all([checks.list(), decisions.list(), settlements ? settlements.list() : []])
    .then(([checkList, decisionList, settlementList]) => ({ checks: checkList, decisions: decisionList, settlements: settlementList }));
  const buildAll = events => buildQueue(data, events, { now: clock(), slaDays });
  const claimView = (request, events) => buildAll(events).items.find(item => item.claimId === request.claimId);

  async function parseBody(req, res) {
    if (!isJsonRequest(req)) return void send(res, 415, { error: "unsupported-media-type" });
    const parsed = await readJsonBody(req);
    if (parsed.status === 413) return void send(res, 413, { error: "payload-too-large" });
    if (parsed.status === 400) return void send(res, 400, { error: "invalid-request" });
    return parsed;
  }

  async function queue(req, res) {
    if (!checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    try {
      const result = buildAll(await stores());
      return send(res, 200, { ...result, facility: data.facility, generatedAt: new Date().toISOString() });
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  async function claimDetail(req, res, request) {
    if (!checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    try {
      const events = await stores();
      const history = [
        ...events.checks.filter(entry => entry.claimId === request.claimId).map(entry => ({ type: "check", at: entry.at, matches: entry.matches, assessorName: entry.assessorName })),
        ...events.decisions.filter(entry => entry.claimId === request.claimId).map(entry => ({ type: "decision", at: entry.at, kind: entry.kind, reason: entry.reason, assessorName: entry.assessorName })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      const all = buildAll(events);
      return send(res, 200, { claim: all.items.find(item => item.claimId === request.claimId), history, related: relatedClaims(data, all.items, request.claimId) });
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  // Asks Junctura whether the claim matches. The member is the data subject; only yes or no comes back.
  async function verify(req, res, request, user) {
    if (!capabilities || !checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    const result = await capabilities.call("claim-verify", { claimId: request.claimId, amountVnd: request.requestedAmountVnd }, { purpose: "claim_review", dataSubject: request.subject });
    const at = clock().toISOString();
    if (callLog) {
      await callLog.add({ capability: "claim-verify", purpose: "claim_review", outcome: result.status, claimId: request.claimId, assessor: user.username, assessorName: user.displayName, at })
        .catch(error => console.error(error?.code ?? "call-log-unavailable"));
    }
    let saved = true;
    if (result.status === "ok") {
      try {
        await checks.add({ claimId: request.claimId, matches: result.output.matches, checkedAt: result.output.checkedAt, assessor: user.username, assessorName: user.displayName, at });
      } catch (error) {
        console.error(error?.code ?? "store-unavailable");
        saved = false;
      }
    }
    try {
      const claim = claimView(request, await stores());
      const outcome = result.status === "ok" ? { status: "ok", matches: result.output.matches, checkedAt: result.output.checkedAt } : { status: result.status };
      return send(res, 200, { result: outcome, saved, claim });
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  async function decide(req, res, request, user) {
    if (!checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    const parsed = await parseBody(req, res);
    if (!parsed) return;
    const decision = validDecision(parsed.body, request.requestedAmountVnd);
    if (!decision) return send(res, 400, { error: "invalid-request" });
    return exclusive(async () => {
      try {
        const events = await stores();
        const blocker = decisionBlocker(claimView(request, events), decision.kind);
        if (blocker) return send(res, 409, { error: blocker });
        const at = clock().toISOString();
        await decisions.add({ claimId: request.claimId, ...decision, assessor: user.username, assessorName: user.displayName, at });
        return send(res, 201, { claim: claimView(request, await stores()) });
      } catch (error) {
        return storeFailure(res, error);
      }
    });
  }

  async function claimRoute(req, res, match, user) {
    const request = data.claims.get(match[1]);
    if (!request) return send(res, 404, { error: "unknown-claim" });
    const action = match[2];
    const allowed = action ? "POST" : "GET, HEAD";
    if (!allowed.split(", ").includes(req.method)) return send(res, 405, { error: "method-not-allowed" }, { allow: allowed });
    if (action === "verify") return verify(req, res, request, user);
    if (action === "decision") return decide(req, res, request, user);
    return claimDetail(req, res, request);
  }

  async function callLogRoute(req, res) {
    if (!callLog) return send(res, 503, { error: "junctura-not-configured" });
    try {
      return send(res, 200, { items: await callLog.list() });
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  const settlementView = ({ settlementId, count, totalVnd, createdByName, at }) => ({ settlementId, count, totalVnd, createdByName, at });

  async function settlementsRoute(req, res, user) {
    if (!settlements || !checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    if (req.method === "POST") {
      return exclusive(async () => {
        try {
          const events = await stores();
          const plan = planSettlement(buildAll(events).items, events.settlements, { at: clock().toISOString(), assessor: user.username, assessorName: user.displayName });
          if (!plan) return send(res, 409, { error: "nothing-to-settle" });
          await settlements.add(plan);
          return send(res, 201, { settlement: settlementView(plan) });
        } catch (error) {
          return storeFailure(res, error);
        }
      });
    }
    try {
      const events = await stores();
      const all = buildAll(events);
      const waiting = all.items.filter(item => item.status === "accepted" && !item.settlementId)
        .map(({ claimId, memberRef, requestedAmountVnd, approvedAmountVnd, decision }) => ({ claimId, memberRef, requestedAmountVnd, approvedAmountVnd, decidedAt: decision?.at ?? null }));
      return send(res, 200, { items: events.settlements.map(settlementView), pending: { count: waiting.length, totalVnd: all.unsettled.totalVnd, claims: waiting } });
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  async function settlementCsvRoute(req, res, id) {
    if (!settlements || !checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    try {
      const events = await stores();
      const settlement = events.settlements.find(entry => entry.settlementId === id);
      if (!settlement) return send(res, 404, { error: "unknown-settlement" });
      const byId = new Map(buildAll(events).items.map(item => [item.claimId, item]));
      const claims = (settlement.claimIds ?? []).map(claimId => byId.get(claimId)).filter(Boolean);
      res.writeHead(200, { ...base, "cache-control": "no-store", "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${id}.csv"` });
      return res.end(settlementCsv(settlement, claims));
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  async function reportRoute(req, res, url) {
    if (!checks || !decisions) return send(res, 503, { error: "junctura-not-configured" });
    try {
      const report = buildReport(buildAll(await stores()).items);
      if (url.pathname === "/api/report.csv") {
        res.writeHead(200, { ...base, "cache-control": "no-store", "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="bao-cao-giam-dinh.csv"' });
        return res.end(reportCsv(report));
      }
      return send(res, 200, { ...report, generatedAt: new Date().toISOString() });
    } catch (error) {
      return storeFailure(res, error);
    }
  }

  async function api(req, res, url) {
    if (url.pathname === "/api/config") {
      return send(res, 200, { issuer: config.issuer, clientId: config.webClientId, facility: data.facility });
    }
    let user;
    try {
      user = await authenticate(req);
    } catch (error) {
      if (!(error instanceof AuthError)) console.error(`token check failed: ${error.message}`);
      return send(res, 401, { error: "unauthenticated" }, { "www-authenticate": "Bearer" });
    }
    if (!user) return send(res, 403, { error: "not-insurance-staff" });
    if (url.pathname === "/api/me") return send(res, 200, user);

    const claimMatch = CLAIM_ROUTE.exec(url.pathname);
    const csvMatch = SETTLEMENT_CSV_ROUTE.exec(url.pathname);
    if (claimMatch || csvMatch || ["/api/claims", "/api/call-log", "/api/report", "/api/report.csv", "/api/settlements"].includes(url.pathname)) {
      if (user.role !== ASSESSOR_ROLE) return send(res, 403, { error: "not-assessor" });
      if (claimMatch) return claimRoute(req, res, claimMatch, user);
      if (csvMatch) return req.method === "GET" || req.method === "HEAD" ? settlementCsvRoute(req, res, csvMatch[1]) : send(res, 405, { error: "method-not-allowed" }, { allow: "GET, HEAD" });
      if (url.pathname === "/api/settlements") return settlementsRoute(req, res, user);
      if (url.pathname === "/api/claims") return queue(req, res);
      if (url.pathname === "/api/call-log") return callLogRoute(req, res);
      return reportRoute(req, res, url);
    }
    return send(res, 404, { error: "not-found" });
  }

  function serveStatic(res, pathname) {
    const target = normalize(join(config.staticDir, pathname === "/" ? "index.html" : pathname));
    const root = config.staticDir + sep;
    let file = target.startsWith(root) && existsSync(target) && statSync(target).isFile() ? target : null;
    // Unknown paths without an extension belong to the single-page app.
    if (!file && !extname(pathname)) file = join(config.staticDir, "index.html");
    if (!file || !existsSync(file)) return send(res, 404, { error: "not-found" });
    const immutable = pathname.startsWith("/assets/");
    res.writeHead(200, { ...base, "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" });
    createReadStream(file).pipe(res);
  }

  return async function handle(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/healthz") return send(res, 200, { status: "ok" });
      // Claim routes check their own methods; unknown /api paths fall through to a 404.
      const allowed = API_METHODS.get(url.pathname) ?? (url.pathname.startsWith("/api/") ? null : "GET, HEAD");
      if (allowed && !allowed.split(", ").includes(req.method)) {
        return send(res, 405, { error: "method-not-allowed" }, { allow: allowed });
      }
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      return serveStatic(res, decodeURIComponent(url.pathname));
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, { error: "internal-error" });
      else res.end();
    }
  };
}
