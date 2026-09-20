# DPDP_NOTES — Digital Personal Data Protection (India) as it applies to CSH 2026

Checked: 2026-09-20. **Not legal advice.** Items needing college/legal approval are listed at the end.

## Status timeline (OBSERVED via cited secondary sources; primary = Gazette/MeitY)
- DPDP Act 2023: enacted; notified Aug 2023 (OBSERVED across all sources).
- DPDP Rules 2025: **notified 2025-11-13** by MeitY, together with the Data Protection Board (DPB) establishment (4 members). (OBSERVED: adplawoffices.com post of 2025-12-15; scconline blog 2025-12-26.)
- **Phased enforcement** (OBSERVED: adplawoffices table; scconline):
  - 2025-11-13: DPB establishment/functioning + definitions in force.
  - 2026-11-13: Consent Manager registration framework in force.
  - **2027-05-13: full implementation** — grounds for processing, notice, consent, reasonable security safeguards, breach intimation, verifiable consent for children, SDF obligations, data-principal rights, cross-border transfer rules.
- INFERRED for CSH: at expected launch (2026), the DPB/definitions are in force but most fiduciary obligations apply from May 2027. Building compliant-by-design now is cheap; retrofit later is not. CSH (a single college's student platform, few thousand accounts) is **not** a Significant Data Fiduciary (no volume/turnover threshold plausibly met — UNVERIFIED until the SDF notification criteria are officially applied to us).

## Obligations → CSH design mapping
| DPDP requirement (source: Rules 2025 summaries in [adp](https://adplawoffices.com/digital-personal-data-protection-rules-2025-notified/), [scc](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/), [ey](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025)) | CSH implementation plan |
|---|---|
| Plain, itemised, separate notice: what is collected, why, how to exercise rights, contact link (Rule 3) | Registration consent screen + legal pages listing exact data fields, purposes, retention, contacts; no hard-coded strings (i18n) |
| Consent: free, specific, informed, unconditional, clear affirmative action; withdrawal mechanism | Explicit consent checkboxes at registration; withdrawal = self-service deletion/export request flow; consent events stored with timestamp |
| Grievance redressal, resolution within 90 days (Rules 2025 summaries) | Named grievance officer + published contact + in-app request form + internal SLA log (90 days) |
| Data principal rights: access, correction, erasure, nomination (Rule 14 framework) | Self-service: export (CSV/JSON), correct profile fields, delete account (queue-based erasure with soft-delete window then purge), nominee contact field |
| Retention: delete when purpose no longer needed; **48-hour notice before erasure** (Rule 8) | Retention schedule per data class in PRIVACY_NOTES.md; erasure flow sends notice, waits, then purges; schedule stored in DB settings |
| Minimum 1-year retention mentioned for fiduciaries in one summary (adplawoffices) | **UNVERIFIED** against the official text; treated as a floor for contest records (results/certificates) — decision pending college/legal |
| Breach: notify affected principals "without delay"; detailed report to DPB within 72 hours (adplawoffices; scconline says "without delay" for principals) | Incident runbook in TROUBLESHOOTING/ADMIN_GUIDE: who to call, template notices, DPB contact; 72h clock starts at detection |
| Publish DPO/responsible officer contact details on the website (Rule 9) | Legal page with officer name/role + email (name is college-approved info — HUMAN GATE) |
| Data minimisation + accuracy duties (Act §§8, 11–12) | Collect only: name, email, phone (optional, masked by role), college ID, department, role data; no marketing data; phone visible only to authorised roles |
| Children's data: verifiable parental consent | CSH is a college event for enrolled students (18+ population is INFERRED, not guaranteed — **college must confirm minimum age**; if <18 participants exist, parental consent flow must be added) |

## Decisions needing college or legal approval
1. Official **grievance/data-protection officer name, role, and email** to publish (human gate).
2. **Retention periods** per data class (registration, documents, evaluation scores, certificates, audit log) — propose: active event + 90 days; certificates/records 3 years; audit log 3 years; then purge (subject to legal sign-off).
3. Confirmation of **minimum participant age** (affects children's-consent obligations).
4. Whether SRM TRP wants CSH to be a **joint fiduciary arrangement** with the college (college as controller for institutional data) — legal question.
5. **Cross-border data transfer**: keep all data in-region (hosting decision D4 favours India residency) — confirm no foreign processors (incl. email provider) will touch personal data, or add transfer basis.
6. The 48-hour pre-erasure notice and 90-day grievance SLA are implemented as-is; legal may want stricter/faster values.

## Sources (all accessed 2026-09-20)
- https://adplawoffices.com/digital-personal-data-protection-rules-2025-notified/ (2025-12-15) — phased timeline, 72h DPB report, 1-year retention note (secondary; verify 1-year floor against Gazette text — UNVERIFIED)
- https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/ (2025-12-26) — Rule 3/7/8/9/14 summaries (secondary)
- https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025 (2026-01-21) — rights + runway (secondary)
- https://vajiramandravi.com/current-affairs/dpdp-act-2023/ (2025-11-26) — Act overview (secondary, educational)
- Primary text to fetch when accessible: DPDP Rules 2025 notification on MeitY/legislative affairs site (sih.gov.in-style WAFs may block; will retry or use gazette.in).
