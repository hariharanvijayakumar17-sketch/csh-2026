DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'declined'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'team_member_status')
  ) THEN
    ALTER TYPE "public"."team_member_status" ADD VALUE 'declined';
  END IF;
END $$;
