ALTER TABLE "users" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_gender_chk" CHECK (gender is null or gender in ('female','male','other'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_proposal_version_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'proposal versions are immutable (S4): create a new version instead';
  END IF;
  -- allowed: freeze a working draft, content byte-identical
  IF NEW.is_final AND NOT OLD.is_final THEN
    IF NEW.title = OLD.title
       AND NEW.solution IS NOT DISTINCT FROM OLD.solution
       AND NEW.abstract IS NOT DISTINCT FROM OLD.abstract
       AND NEW.problem_understanding IS NOT DISTINCT FROM OLD.problem_understanding
       AND NEW.innovation IS NOT DISTINCT FROM OLD.innovation
       AND NEW.architecture IS NOT DISTINCT FROM OLD.architecture
       AND NEW.tech_stack IS NOT DISTINCT FROM OLD.tech_stack
       AND NEW.plan IS NOT DISTINCT FROM OLD.plan
       AND NEW.impact IS NOT DISTINCT FROM OLD.impact
       AND NEW.feasibility IS NOT DISTINCT FROM OLD.feasibility
       AND NEW.sustainability IS NOT DISTINCT FROM OLD.sustainability
       AND NEW.future_scope IS NOT DISTINCT FROM OLD.future_scope
       AND NEW.version_no = OLD.version_no THEN
      RETURN NEW;
    END IF;
  END IF;
  -- working drafts (is_final=false) may be edited freely
  IF NOT OLD.is_final THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'proposal versions are immutable (S4): create a new version instead';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER proposal_versions_immutable
BEFORE UPDATE OR DELETE ON proposal_versions
FOR EACH ROW EXECUTE FUNCTION prevent_proposal_version_change();
