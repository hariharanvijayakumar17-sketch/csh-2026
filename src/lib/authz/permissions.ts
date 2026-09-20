/**
 * Central authorisation (brief S1): ONE function — can(user, permission, ctx) —
 * used by every route. Decisions are by PERMISSION, never by role name in
 * handlers. Scope-aware: leader powers are scoped to the caller's own team
 * (members do NOT inherit them), SPOC powers to their own institution,
 * mentor/evaluator powers to ASSIGNED teams/evaluations only.
 *
 * S5: a declared conflict (potential|conflict) blocks scoring.
 * S3: "own" vs "all" are distinct permissions (evaluators never see other
 * evaluators' scores; no cross-team/cross-institution access).
 */

export const Permissions = {
  // --- teams -------------------------------------------------------------
  teamCreate: "team.create",
  teamView: "team.view",
  teamUpdate: "team.update", // leader, draft state (service checks state)
  teamInvite: "team.invite_member",
  teamRemoveMember: "team.remove_member",
  teamWithdraw: "team.withdraw",
  teamVerify: "team.verify", // SPOC own institution
  teamShortlist: "team.shortlist", // SPOC own institution
  teamUploadDocument: "team.upload_document", // own team (or SPOC own inst, letter)
  // --- proposals ---------------------------------------------------------
  proposalCreate: "proposal.create",
  proposalView: "proposal.view",
  proposalUpdate: "proposal.update", // leader own team, editable state
  proposalSubmit: "proposal.submit", // leader own team (transactional in service)
  proposalReview: "proposal.review", // SPOC/creator: changes_requested/approved
  proposalLock: "proposal.lock", // admin
  // --- documents (S2 matrix enforced HERE + in service for state/deadline)
  documentView: "document.view",
  documentUpload: "document.upload",
  // --- problems ----------------------------------------------------------
  problemCreate: "problem.create",
  problemUpdate: "problem.update", // creator, before approval
  problemSubmitReview: "problem.submit_review",
  problemApprove: "problem.approve", // admin
  problemPublish: "problem.publish", // admin
  problemClose: "problem.close", // admin/creator
  problemArchive: "problem.archive", // creator/admin
  problemClarify: "problem.clarify", // creator
  // --- rounds/criteria ---------------------------------------------------
  roundManage: "round.manage", // admin
  // --- evaluations (S3/S4/S5) --------------------------------------------
  evaluationAssign: "evaluation.assign", // admin
  evaluationViewOwn: "evaluation.view_own",
  evaluationScore: "evaluation.score", // own, state-allowed, no conflict
  evaluationSubmit: "evaluation.submit", // own, all criteria, transactional
  evaluationViewAll: "evaluation.view_all", // admin only
  evaluationReopen: "evaluation.reopen", // admin
  evaluationConflictDeclare: "evaluation.conflict_declare", // own evaluator
  // --- results / certificates --------------------------------------------
  resultsDraft: "results.draft", // admin (SPOC assist? admin-only in v1)
  resultsPublish: "results.publish", // admin
  certificateIssue: "certificate.issue", // admin
  // --- SPOC portal --------------------------------------------------------
  spocViewTeams: "spoc.view_teams",
  spocInternalReport: "spoc.internal_report",
  spocAnalytics: "spoc.analytics",
  spocExport: "spoc.export",
  spocImport: "spoc.import",
  // --- mentor -------------------------------------------------------------
  mentorViewTeams: "mentor.view_teams", // assigned only
  mentorFeedback: "mentor.feedback", // assigned only
  // --- announcements -------------------------------------------------------
  announcementCreate: "announcement.create",
  announcementUpdate: "announcement.update",
  // --- settings/flags/admin ------------------------------------------------
  settingsWrite: "settings.write",
  featureFlagWrite: "feature_flag.write",
  userAdminister: "user.administer", // role changes, lock (priv-rotation in service)
  adminExport: "admin.export",
  // --- self ----------------------------------------------------------------
  notificationViewSelf: "notification.view_self",
  notificationMarkReadSelf: "notification.mark_read_self",
  sessionViewSelf: "session.view_self",
  sessionLogoutSelf: "session.logout_self",
  passwordChangeSelf: "password.change_self",
  exportJobViewSelf: "export_job.view_self",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export interface UserLike {
  id: string;
  role:
    | "super_admin"
    | "spoc"
    | "problem_creator"
    | "mentor"
    | "evaluator"
    | "participant";
  institutionId?: string | null;
  email?: string | null;
  fullName?: string | null;
}

export interface CanContext {
  team?: {
    id: string;
    institutionId: string;
    leaderUserId: string;
  };
  proposal?: { teamId: string };
  document?: { ownerKind: "team" | "proposal"; ownerId: string; teamId?: string };
  problem?: { creatorUserId?: string | null };
  evaluation?: {
    id: string;
    evaluatorUserId: string;
    proposalTeamId: string;
    proposalInstitutionId?: string;
    conflict?: "potential" | "conflict" | null;
    status: "assigned" | "in_progress" | "submitted" | "locked" | "reopened";
  };
  institutionId?: string; // for institution-scoped resources
  announcement?: { audience: string; createdById: string; status: string };
  /** Runtime-resolved assignment sets (filled by the service layer). */
  ownTeamIds?: Set<string>; // teams the user belongs to
  mentorAssignedTeamIds?: Set<string>;
  evaluatorAssignedTeamIds?: Set<string>;
}

export type ScopedContext = CanContext;

export function can(
  user: UserLike | null,
  permission: Permission,
  ctx: CanContext = {}
): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;

  switch (permission) {
    // --- self actions: any authenticated user ---
    case Permissions.notificationViewSelf:
    case Permissions.notificationMarkReadSelf:
    case Permissions.sessionViewSelf:
    case Permissions.sessionLogoutSelf:
    case Permissions.passwordChangeSelf:
    case Permissions.exportJobViewSelf:
      return true;

    // --- team flow ---
    case Permissions.teamCreate:
      return user.role === "participant";

    case Permissions.teamView: {
      if (!ctx.team) return false;
      if (user.role === "spoc")
        return ctx.team.institutionId === user.institutionId;
      if (user.role === "mentor" || user.role === "evaluator")
        return ctx.mentorAssignedTeamIds?.has(ctx.team.id) ??
          ctx.evaluatorAssignedTeamIds?.has(ctx.team.id) ??
          false;
      // participant: only own team (leader or member)
      return ctx.ownTeamIds?.has(ctx.team.id) ?? false;
    }

    case Permissions.teamUpdate:
    case Permissions.teamInvite:
    case Permissions.teamRemoveMember:
    case Permissions.teamWithdraw: {
      // LEADER OF OWN TEAM ONLY — members do not inherit leader powers (§5.1)
      const t = ctx.team;
      return (
        !!t &&
        t.leaderUserId === user.id &&
        (ctx.ownTeamIds?.has(t.id) ?? false)
      );
    }

    case Permissions.teamVerify:
    case Permissions.teamShortlist:
      return (
        user.role === "spoc" && !!ctx.team &&
        ctx.team.institutionId === user.institutionId
      );

    case Permissions.teamUploadDocument:
      return isOwnTeamUploader(user, ctx);

    // --- proposals ---
    case Permissions.proposalCreate:
    case Permissions.proposalUpdate:
    case Permissions.proposalSubmit: {
      const t = teamOfProposal(ctx);
      return (
        !!t &&
        t.leaderUserId === user.id &&
        (ctx.ownTeamIds?.has(t.id) ?? false)
      );
    }

    case Permissions.proposalView: {
      const t = teamOfProposal(ctx);
      if (!t) return false;
      if (user.role === "spoc") return t.institutionId === user.institutionId;
      if (user.role === "mentor" || user.role === "evaluator")
        return (
          ctx.mentorAssignedTeamIds?.has(t.id) ??
          ctx.evaluatorAssignedTeamIds?.has(t.id) ??
          false
        );
      return ctx.ownTeamIds?.has(t.id) ?? false;
    }

    case Permissions.proposalReview:
      return (
        (user.role === "spoc" || user.role === "problem_creator") &&
        !!ctx.team &&
        (user.role === "spoc"
          ? ctx.team.institutionId === user.institutionId
          : true)
      );

    case Permissions.proposalLock:
      return false; // admin only (handled by super_admin early-return)

    // --- documents (S2) ---
    case Permissions.documentView:
      return isOwnTeamUploader(user, ctx);
    case Permissions.documentUpload:
      return isOwnTeamUploader(user, ctx);

    // --- problems ---
    case Permissions.problemCreate:
      return user.role === "problem_creator";
    case Permissions.problemUpdate:
    case Permissions.problemSubmitReview:
    case Permissions.problemClarify:
    case Permissions.problemClose:
      return (
        user.role === "problem_creator" &&
        !!ctx.problem &&
        ctx.problem.creatorUserId === user.id
      );
    case Permissions.problemArchive:
      return (
        (user.role === "problem_creator" &&
          !!ctx.problem &&
          ctx.problem.creatorUserId === user.id)
      );
    case Permissions.problemApprove:
    case Permissions.problemPublish:
      return false; // admin only

    case Permissions.roundManage:
      return false; // admin only

    // --- evaluations (S3 own vs all; S5 conflict block) ---
    case Permissions.evaluationAssign:
    case Permissions.evaluationViewAll:
    case Permissions.evaluationReopen:
      return false; // admin only

    case Permissions.evaluationViewOwn:
      return (
        user.role === "evaluator" &&
        !!ctx.evaluation &&
        ctx.evaluation.evaluatorUserId === user.id
      );

    case Permissions.evaluationScore:
    case Permissions.evaluationSubmit: {
      if (user.role !== "evaluator" || !ctx.evaluation) return false;
      if (ctx.evaluation.evaluatorUserId !== user.id) return false;
      // S5: any declared conflict blocks scoring
      if (ctx.evaluation.conflict) return false;
      // locked evaluations cannot be scored until admin reopens
      if (ctx.evaluation.status === "locked") return false;
      return true;
    }

    case Permissions.evaluationConflictDeclare:
      return (
        user.role === "evaluator" &&
        !!ctx.evaluation &&
        ctx.evaluation.evaluatorUserId === user.id
      );

    // --- results / certificates ---
    case Permissions.resultsDraft:
    case Permissions.resultsPublish:
    case Permissions.certificateIssue:
      return false; // admin only

    // --- SPOC portal (own institution only) ---
    case Permissions.spocViewTeams:
    case Permissions.spocInternalReport:
    case Permissions.spocAnalytics:
    case Permissions.spocExport:
    case Permissions.spocImport:
      return (
        user.role === "spoc" &&
        (ctx.institutionId === undefined ||
          ctx.institutionId === user.institutionId)
      );

    // --- mentor (assigned teams only) ---
    case Permissions.mentorViewTeams:
      return (
        user.role === "mentor" &&
        (!!ctx.team && (ctx.mentorAssignedTeamIds?.has(ctx.team.id) ?? false))
      );
    case Permissions.mentorFeedback:
      return (
        user.role === "mentor" &&
        (!!ctx.team && (ctx.mentorAssignedTeamIds?.has(ctx.team.id) ?? false))
      );

    // --- announcements ---
    case Permissions.announcementCreate:
      return user.role === "spoc" || user.role === "problem_creator";
    case Permissions.announcementUpdate:
      return (
        !!ctx.announcement &&
        (user.id === ctx.announcement.createdById ||
          user.role === "spoc" ||
          user.role === "problem_creator")
      );

    // --- admin settings ---
    case Permissions.settingsWrite:
    case Permissions.featureFlagWrite:
    case Permissions.userAdminister:
    case Permissions.adminExport:
      return false; // admin only
  }
}

/** Service layer must pass ctx.team matching ctx.proposal.teamId. */
function teamOfProposal(ctx: CanContext) {
  return ctx.team;
}

/**
 * S2 document ACL: team members, the SPOC of the owning institution, the
 * assigned mentor, the assigned evaluator (respecting blind mode — handled by
 * the service hiding the team identity, not here), and admins (early-return).
 */
function isOwnTeamUploader(user: UserLike, ctx: CanContext): boolean {
  if (!ctx.document) return false;
  const teamId =
    ctx.document.ownerKind === "team"
      ? ctx.document.ownerId
      : ctx.document.teamId;
  if (!teamId) return false;
  const t = ctx.team;
  if (!t || t.id !== teamId) return false;
  if (user.role === "spoc") return t.institutionId === user.institutionId;
  if (user.role === "mentor")
    return ctx.mentorAssignedTeamIds?.has(teamId) ?? false;
  if (user.role === "evaluator")
    return ctx.evaluatorAssignedTeamIds?.has(teamId) ?? false;
  return ctx.ownTeamIds?.has(teamId) ?? false;
}
