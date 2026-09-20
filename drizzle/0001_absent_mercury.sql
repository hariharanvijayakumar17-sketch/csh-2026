CREATE TABLE "login_delays" (
	"user_id" uuid NOT NULL,
	"client_ip" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"delay_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_delays_pk" PRIMARY KEY("user_id","client_ip")
);
--> statement-breakpoint
ALTER TABLE "login_delays" ADD CONSTRAINT "login_delays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "failed_attempts";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "locked_until";