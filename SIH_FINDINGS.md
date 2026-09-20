# SIH_FINDINGS — public Smart India Hackathon workflow (for CSH 2026 parity)

Checked: 2026-09-20 (Asia/Calcutta). Legend: **OBSERVED** = read directly on cited page;
**INFERRED** = derived from observed facts; **CSH DECISION** = our design choice inspired by it;
**UNVERIFIED** = lead not confirmed against a primary source.

## Source note (bot access)
- `https://sih.gov.in/` returned **403 Forbidden (Microsoft-Azure-Application-Gateway)** to our fetcher on 2026-09-20. Direct verification of the primary site from the sandbox is BLOCKED (bot WAF / JS rendering).
- Secondary sources used (each marked where used): official SIH 2025 guidelines PDF hosted by an academic institution (solamalaice.ac.in), SlideShare upload of the same guidelines deck, a college SPOC guidelines update (scribd), and two college-hosted SIH 2026 guidance pages (bcrec.ac.in, rjit.ac.in) plus a student write-up (thenewviews.com) and a Reddit NSUT guide. These are **secondary**; where two independent secondary sources agree on a numeric rule, confidence is higher, but it remains not primary-verified.

## 1. SPOC role
- OBSERVED (solamalaice SIH-new.pdf): SPOC = senior faculty (Lecturer…Professor/HOD/Dean/Director/Principal or designated official). SPOC registers on portal; SIH implementation team authorizes the SPOC account; after verification SPOC gains portal access. SPOC coordinates the internal hackathon, manages registrations, ensures guideline compliance.
- OBSERVED (rjit.ac.in/sih2025): college lists its SPOC publicly with a contact page for the internal round.
- INFERRED: SPOC is the institution's single accountable operator: verify members, upload team data, nominate, upload authorisation letter, follow up with the implementation team.
- CSH DECISION: implement the SPOC portal per brief §5.1 (verify members/documents, nominate, internal-hackathon report, media/jury info, shortlist, announcements, exports, analytics) — superset of observed SIH SPOC duties, editable in DB.

## 2. Internal hackathon → nomination
- OBSERVED (solamalaice PDF): "Only students selected in the Internal Hackathon can be registered"; "The college SPOC nominates top teams based on internal hackathon results".
- OBSERVED (bcrec.ac.in SIH 2026 page, secondary): "Only teams selected through internal screening can be nominated".
- CSH DECISION: CSH is a single-college (SRM TRP) event, so its natural mode is an internal hackathon: self-registration or SPOC-imported (registration_mode internal/external per §5.2), internal evaluation, shortlist, final results. The "nomination to a national portal" step does not exist for CSH; the closest analogue is SPOC verification + shortlisting + publishable results.

## 3. Team formation and size
- OBSERVED (solamalaice PDF, SIH 2025): exactly 6 members including leader; all from the same college (no inter-college teams); at least one female member mandatory; team name unique and must not contain the institute name.
- OBSERVED (bcrec.ac.in SIH 2026, secondary): same 6-member/1-female/same-institute rules repeated for 2026; up to 2 mentors for grand finale.
- CSH DECISION: all composition rules DB-editable (min/max members, same-institution rule, gender/diversity rules as named constraints, team-name uniqueness + reserved-word check) rather than hard-coded 6/1-female, per §5.2. Defaults seedable to 6 + 1 female to mirror SIH.

## 4. Leader as contact
- OBSERVED (solamalaice PDF): "Nominated Team's team leader will get the Login credentials after SPOC upload team details in the portal to complete the idea submission process"; leader verifies pre-entered team name, authorisation letter PDF, member names/genders, emails, mobiles.
- CSH DECISION: Team Leader is the single login/point-of-contact for team actions (member invites, problem selection, proposal, uploads); members get scoped accounts but NOT leader powers (brief §5.1).

## 5. Idea submission fields and limits
- OBSERVED (solamalaice PDF): leader submits — chosen problem statement (or Student Innovation category), idea title, idea description, idea presentation (PDF).
- OBSERVED (solamalaice PDF): "One team can submit Ideas against maximum of 2 Problem Statement only"; "only 500 ideas will be submitted for a particular PS. Once the count number got all 500 ideas, the particular PS will get freeze"; counters (submitted/remaining) displayed publicly on sih.gov.in.
- OBSERVED (bcrec slide structure, secondary): fixed 6-slide deck (title w/ PS ID + team ID, proposed solution, technical approach, feasibility, impact, references).
- OBSERVED (reddit NSUT guide, secondary, UNVERIFIED for 2026): 2025 also required PPT + code + demo video in the external round; 500-team PS cap fluctuated (300→500) during the 2025 cycle.
- CSH DECISION: proposal builder fields (title, abstract, problem understanding, solution, innovation, architecture, stack, plan, impact, feasibility, sustainability, future scope, files) are our superset; per-problem cap and per-team problem limit are DB settings; public PS cards show live submission counts + "frozen" state when cap reached.

## 6. Authorisation letter
- OBSERVED (solamalaice PDF): letter must be on college letterhead; state team name + all 6 members; signed by principal/dean/director; bear college seal; required at grand finale if selected.
- OBSERVED (sih-lemon-eight.vercel.app/rules, secondary 2026 page): letter must also list up to 2 mentors.
- CSH DECISION: SPOC verification step accepts an uploaded authorisation/consent letter (PDF) per team; stored under document ACL rules (S2); requirement flag DB-configurable.

## 7. Evaluation criteria
- OBSERVED (solamalaice PDF / slideshare): post-submission ideas evaluated by experts; criteria: novelty, complexity, clarity and details in prescribed format, feasibility, practicability, sustainability, scale of impact, user experience, potential for future work progression.
- OBSERVED (thenewviews.com, secondary): internal panels commonly score innovation, relevance to PS, technical approach, feasibility, impact, presentation.
- INFERRED: criteria are weighted in practice even where weights aren't published.
- CSH DECISION: weighted criteria per round (weights must total 100, validated on create/edit/activate) per §5.2; seed with the observed SIH criterion names as a starting set.

## 8. Mentoring
- OBSERVED (solamalaice PDF): "Be available for meetings, sessions and trainings during the preparation phase; you will be notified about them in advance".
- OBSERVED (bcrec, secondary): up to 2 mentors for the grand finale (listed in the letter).
- CSH DECISION: mentor portal with assigned teams only; feedback stored separately from scores (brief §5.1); mentoring session records optional module.

## 9. Finale
- OBSERVED (solamalaice PDF): grand finale offline at nodal centres pan-India; 4–5 teams per PS may be selected; final decision rests with the PS-creating organisation, not obligated to declare a winner; college photo ID + consent letter mandatory for finale participation; travel/accommodation supported; IP of winning ideas split between the PS organisation and the winning team (or by mutual agreement); winning ideas "supported to be developed further".
- CSH DECISION: results workflow (verify → rank → review → draft → publish → notify) with per-PS awards and an explicit "no winner declared" path; winner certificate issuance (unique ID + public verify page).

## 10. Numbers to remember (SIH 2025, OBSERVED in the guidelines deck via secondary hosts)
| Rule | Value | Source(s) |
|---|---|---|
| Teams per institute (incl. waitlist) | max 50 (45 shortlisted + 5 waitlisted) | solamalaice PDF; slideshare; bcrec (2026 page repeats 50) |
| Teams per university | max 100 | scribd SPOC guidelines update (single source — treat as UNVERIFIED) |
| Ideas per PS (national) | 500, then PS freezes | solamalaice PDF; slideshare |
| PS per team | max 2 | solamalaice PDF; slideshare; bcrec |
| Finale teams per PS | ~4–5, PS org's call | solamalaice PDF |
| Team size | exactly 6 incl. leader, ≥1 female, same college | solamalaice PDF; bcrec; rjit |

## 11. What CSH explicitly does NOT copy
No SIH logos, names, deck text, or visual identity; the workflow parity above is structural (roles, state transitions, caps, letter, evaluation shape) only, with original branding, original field labels (translated-safe), and our own criterion wording where needed. (Brief §3.)
