import { Permissions, type Permission } from "./permissions";

/**
 * Route inventory + explicit policy per route (brief S1).
 *
 * The automated test (route-inventory.test.ts) WALKS this registry and FAILS
 * the build if any route lacks an explicit policy. "public" is allowed only
 * for reads/token endpoints; every scoped resource MUST map to a Permission
 * enforced by can() — there is deliberately NO bare "authenticated" policy.
 *
 * P4+ handlers are added 1:1 to this list; the middleware resolves the policy
 * from here, so a route cannot ship without a policy.
 */

export type RoutePolicy =
  | { kind: "public"; reason: string }
  | { kind: "permission"; permission: Permission };

export interface RouteEntry {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  policy: RoutePolicy;
  /** What the service must resolve before can() (documented scope). */
  scope?: string;
}

const P = (p: Permission, scope?: string): RouteEntry => ({
  method: "GET",
  policy: { kind: "permission", permission: p },
  scope,
});
const POST = (p: Permission, scope?: string): RouteEntry => ({
  ...P(p, scope),
  method: "POST",
});
const PATCH = (p: Permission, scope?: string): RouteEntry => ({
  ...P(p, scope),
  method: "PATCH",
});
const DEL = (p: Permission, scope?: string): RouteEntry => ({
  ...P(p, scope),
  method: "DELETE",
});
const PUB = (reason: string): RouteEntry => ({
  method: "GET",
  policy: { kind: "public", reason },
});
const PUBPOST = (reason: string): RouteEntry => ({
  method: "POST",
  policy: { kind: "public", reason },
});

export const ROUTE_POLICIES: Record<string, RouteEntry[]> = {
  // ---------- system ----------
  "/api/v1/health": [PUB("liveness; no data")],
  "/api/v1/openapi": [PUB("OpenAPI 3.1 document generated from the Zod contracts")],
  "/api/v1/readyz": [PUB("readiness; no data")],

  // ---------- auth ----------
  "/api/v1/auth/register": [
    PUBPOST("registration; service enforces registration_mode (S11) + rate limit"),
  ],
  "/api/v1/auth/verify-email": [
    PUBPOST("single-use hashed token endpoint (S7)"),
  ],
  "/api/v1/auth/login": [
    PUBPOST("login; rate-limited per account+IP; non-enumerating (S7/S8)"),
  ],
  "/api/v1/auth/logout": [POST(Permissions.sessionLogoutSelf, "self session")],
  "/api/v1/auth/session": [P(Permissions.sessionViewSelf, "self session")],
  "/api/v1/auth/password-reset/request": [
    PUBPOST("reset request; rate-limited, non-enumerating (S7)"),
  ],
  "/api/v1/auth/password-reset/confirm": [
    PUBPOST("reset confirm; single-use hashed token (S7)"),
  ],
  "/api/v1/auth/password/change": [
    POST(Permissions.passwordChangeSelf, "self; revokes all sessions (S7/S9)"),
  ],

  // ---------- public content ----------
  "/api/v1/problems": [PUB("published problems only (paginated)")],
  "/api/v1/problems/:id": [
    PUB("published; drafts only via problemUpdate-capable caller (service gate)"),
  ],
  "/api/v1/announcements": [PUB("published; audience-filtered (service)")],
  "/api/v1/results": [PUB("published rows only (service)")],
  "/api/v1/certificates/verify/:no": [
    PUB("limited fields: validity, name, team, event, award, date, ID (§5.4)"),
  ],
  "/api/v1/pages/:slug": [PUB("published CMS pages")],

  // ---------- teams (participant flow) ----------
  "/api/v1/teams": [
    POST(Permissions.teamCreate, "participant self; composition rules from settings"),
  ],
  "/api/v1/teams/mine": [P(Permissions.teamListMine, "authenticated self-list; service scopes by role (F10 fix: team.view 403d on empty ctx)")],
  "/api/v1/teams/:id": [
    P(Permissions.teamView, "own team / SPOC own inst / assigned mentor-evaluator / admin"),
    PATCH(Permissions.teamUpdate, "leader of own team, draft state"),
    DEL(Permissions.teamWithdraw, "leader of own team"),
  ],
  "/api/v1/teams/:id/invites": [
    POST(Permissions.teamInvite, "leader of own team"),
  ],
  "/api/v1/teams/:id/members/:userId": [
    DEL(Permissions.teamRemoveMember, "leader of own team; not the leader row"),
  ],
  "/api/v1/teams/:id/problems": [
    POST(Permissions.teamUpdate, "leader of own team; cap from settings"),
  ],
  "/api/v1/teams/:id/documents": [
    P(Permissions.documentView, "S2 matrix; lists team + team-proposal docs"),
    POST(Permissions.documentUpload, "F2: accepted members of the team only (letter purpose -> 400, use letter route)"),
  ],
  "/api/v1/teams/:id/documents/authorization-letter": [
    POST(Permissions.documentUploadLetter, "F2: SPOC of the team's institution; purpose fixed in URL"),
  ],
  "/api/v1/teams/:id/accept": [
    POST(Permissions.teamAcceptInvite, "F1: invited user accepts; service validates pending invite + same institution"),
  ],
  "/api/v1/teams/:id/decline": [
    POST(Permissions.teamDeclineInvite, "F1: invited user declines (declines the pending row)"),
  ],
  "/api/v1/teams/:id/proposals": [
    POST(Permissions.proposalCreate, "leader of own team (team scope from URL)"),
  ],

  // ---------- proposals ----------
  "/api/v1/proposals/mine": [P(Permissions.proposalView, "own team proposals")],
  "/api/v1/proposals/:id": [
    P(Permissions.proposalView, "scoped audience (can)"),
    PATCH(Permissions.proposalUpdate, "leader own team; state-allowed; autosave"),
  ],
  "/api/v1/proposals/:id/submit": [
    POST(Permissions.proposalSubmit, "leader own team; ONE transaction (S4)"),
  ],
  "/api/v1/proposals/:id/documents": [
    POST(Permissions.documentUpload, "S2 matrix; deadline+lock checked in service"),
  ],
  "/api/v1/documents/:id": [
    P(Permissions.documentView, "S2 ACL matrix"),
  ],
  "/api/v1/documents/:id/download": [
    P(Permissions.documentView, "authenticated streaming / short-lived signed URL (S10)"),
  ],

  // ---------- SPOC portal ----------
  "/api/v1/spoc/teams": [P(Permissions.spocViewTeams, "own institution")],
  "/api/v1/spoc/teams/:id/verify": [
    POST(Permissions.teamVerify, "own institution; letter document required"),
  ],
  "/api/v1/spoc/teams/:id/shortlist": [
    POST(Permissions.teamShortlist, "own institution"),
  ],
  "/api/v1/spoc/internal-report": [
    POST(Permissions.spocInternalReport, "own institution"),
  ],
  "/api/v1/spoc/analytics": [P(Permissions.spocAnalytics, "own institution")],
  "/api/v1/spoc/exports": [POST(Permissions.spocExport, "own institution")],
  "/api/v1/spoc/imports": [
    POST(Permissions.spocImport, "own institution; external mode only (S11)"),
  ],

  // ---------- creator portal ----------
  "/api/v1/problems/create": [POST(Permissions.problemCreate, "creator draft")],
  "/api/v1/problems/:id/edit": [
    PATCH(Permissions.problemUpdate, "creator of own PS, pre-approval"),
  ],
  "/api/v1/problems/:id/submit": [
    POST(Permissions.problemSubmitReview, "creator of own PS"),
  ],
  "/api/v1/problems/:id/clarifications": [
    POST(Permissions.problemClarify, "creator of own PS"),
    PUB("published problems only; Q&A rows (service gates to published)"),
  ],
  "/api/v1/problems/:id/archive": [
    POST(Permissions.problemArchive, "creator of own PS / admin"),
  ],
  "/api/v1/problems/:id/approve": [POST(Permissions.problemApprove, "admin")],
  "/api/v1/problems/:id/publish": [POST(Permissions.problemPublish, "admin")],
  "/api/v1/problems/:id/close": [POST(Permissions.problemClose, "creator/admin")],

  // ---------- rounds & criteria (admin) ----------
  "/api/v1/rounds": [POST(Permissions.roundManage, "admin")],
  "/api/v1/rounds/:id": [PATCH(Permissions.roundManage, "admin; weights sum=100 validated")],
  "/api/v1/rounds/:id/criteria": [POST(Permissions.roundManage, "admin; sum=100 on create/edit/activate")],
  "/api/v1/rounds/:id/activate": [POST(Permissions.roundManage, "admin; sum=100 enforced")],

  // ---------- evaluator portal ----------
  "/api/v1/evaluator/evaluations": [
    P(Permissions.evaluationViewOwn, "assigned to this evaluator ONLY (S3)"),
  ],
  "/api/v1/evaluator/evaluations/:id": [
    P(Permissions.evaluationViewOwn, "own evaluation ONLY (S3)"),
    PATCH(Permissions.evaluationScore, "own; conflict+lock blocked (S5); state checked"),
  ],
  "/api/v1/evaluator/evaluations/:id/submit": [
    POST(Permissions.evaluationSubmit, "own; all criteria; ONE transaction (S4)"),
  ],
  "/api/v1/evaluator/evaluations/:id/conflict": [
    POST(Permissions.evaluationConflictDeclare, "own; notifies admins + audit (S5)"),
  ],

  // ---------- admin ----------
  "/api/v1/admin/evaluations/assign": [POST(Permissions.evaluationAssign, "admin")],
  "/api/v1/admin/evaluations/:id/reopen": [POST(Permissions.evaluationReopen, "admin; audit")],
  "/api/v1/admin/results/draft": [POST(Permissions.resultsDraft, "admin")],
  "/api/v1/admin/results/publish": [
    POST(Permissions.resultsPublish, "admin; transactional; notifies (S-results)"),
  ],
  "/api/v1/admin/certificates/issue": [POST(Permissions.certificateIssue, "admin; unique ID")],
  "/api/v1/admin/settings/:key": [PATCH(Permissions.settingsWrite, "admin")],
  "/api/v1/admin/feature-flags/:key": [PATCH(Permissions.featureFlagWrite, "admin")],
  "/api/v1/admin/users/:id/role": [
    PATCH(Permissions.userAdminister, "admin; session rotation on privilege change (S9)"),
  ],
  "/api/v1/admin/users/:id/lock": [POST(Permissions.userAdminister, "admin")],
  "/api/v1/admin/exports": [POST(Permissions.adminExport, "admin")],

  // ---------- announcements ----------
  "/api/v1/announcements/create": [POST(Permissions.announcementCreate, "spoc/creator")],
  "/api/v1/announcements/:id": [PATCH(Permissions.announcementUpdate, "author/spoc/creator")],

  // ---------- mentor portal ----------
  "/api/v1/mentor/teams": [P(Permissions.mentorViewTeams, "assigned teams ONLY")],
  "/api/v1/mentor/teams/:id/feedback": [
    POST(Permissions.mentorFeedback, "assigned team ONLY; separate from scores (§5.1)"),
  ],

  // ---------- notifications / jobs ----------
  "/api/v1/notifications": [P(Permissions.notificationViewSelf, "self")],
  "/api/v1/notifications/:id/read": [POST(Permissions.notificationMarkReadSelf, "self")],
  "/api/v1/export-jobs/:id": [P(Permissions.exportJobViewSelf, "requester only")],
};
