<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog

All notable changes to Junctura Insurance are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- **Claims assessor app**: sign-in with Junctura (OIDC, PKCE) limited to the `claims-assessor` role; claim queue with
  status, claim-code search, amount band and facility filters; claim page that calls the `claim-verify` capability
  (purpose `claim_review`) and shows only matches / does not match with the check time.
- **Decisions**: accept, reject or ask for an explanation, each with a 3 to 300 character reason and a confirmation
  dialog. Accepting needs a matching latest check; accepted and rejected claims are final; an explanation request can
  be followed by another decision.
- **Report** with mismatch rate, accepted / rejected / open totals, a monthly chart with a text alternative, and a CSV
  download that defuses spreadsheet formulas.
- **Junctura call log** (who, when, outcome) that never stores treatment data.
- **Privacy**: the member id never leaves the server; the browser only sees a shortened reference. Insurance never
  shows diagnoses or treatment detail.
- **Due dates (SLA)**: every claim has a due date (30 days from submission by default, `INSURANCE_SLA_DAYS`); the
  queue shows days left or overdue in words and puts the soonest due first; "overdue" and "flagged" views.
- **Flags to look closer**: repeat claims by the same member within 30 days, an amount above twice the median, an
  earlier mismatch or rejection by the same member. Built from amounts, dates and earlier answers only; they never
  block a decision. The claim page lists the member's other claims.
- **Partial acceptance**: an acceptance can name a lower amount (never higher); the reduction is recorded and shown in
  the report.
- **Batch check** of unchecked claims (25 at a time, oldest first, stops when Junctura is unreachable).
- **Settlements**: accepted claims are grouped into a payment batch (`QT-yyyymmdd-nn`), each claim in one batch only,
  with a CSV for accounting. Decisions and settlements are serialised so a claim cannot be accepted or paid twice.
- Demo dates are moved forward by whole days from the seed's reference date, like the other apps.
- Four states on every screen (loading, empty, error, not permitted), phone layout, light and dark themes.
- Server tests (`node:test`) and web tests (Vitest, Testing Library); CI with SPDX / REUSE checks, build and release
  workflow.
- Demo accounts and claim requests are read from the synthetic seed of `junctura-health`; nothing is copied into
  this repository.
