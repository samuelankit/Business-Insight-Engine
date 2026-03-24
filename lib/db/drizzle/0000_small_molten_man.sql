CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "email_otps" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "email" text NOT NULL,
        "hashed_code" text NOT NULL,
        "expires_at" timestamp NOT NULL,
        "used_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "token" text NOT NULL,
        "encrypted_dek" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp,
        CONSTRAINT "user_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
        "id" text PRIMARY KEY NOT NULL,
        "device_id" text NOT NULL,
        "platform" text DEFAULT 'ios' NOT NULL,
        "suspended" boolean DEFAULT false NOT NULL,
        "email" text,
        "email_verified" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "users_device_id_unique" UNIQUE("device_id"),
        CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "voice_preferences" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "provider" text DEFAULT 'google' NOT NULL,
        "voice_name" text,
        "speech_rate" text,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "voice_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "sector" text,
        "country" text DEFAULT 'GB' NOT NULL,
        "is_active" boolean DEFAULT false NOT NULL,
        "disclosure_message" text,
        "account_type" text,
        "intent" text,
        "background" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telnyx_configs" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "encrypted_api_key" text,
        "phone_number" text,
        "sip_username" text,
        "disclosure_message" text,
        "consent_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "telnyx_configs_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "provider" text NOT NULL,
        "encrypted_key" text NOT NULL,
        "encrypted_dek" text NOT NULL,
        "masked_key" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "agent_id" text NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "summary" text NOT NULL,
        "actions" jsonb DEFAULT '[]'::jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_pending_actions" (
        "id" text PRIMARY KEY NOT NULL,
        "agent_id" text NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "action_type" text NOT NULL,
        "action_description" text NOT NULL,
        "action_payload" jsonb,
        "tool_name" text NOT NULL,
        "function_name" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "result_payload" jsonb,
        "expires_at" timestamp NOT NULL,
        "resolved_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "type" text DEFAULT 'custom' NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "system_prompt" text NOT NULL,
        "is_built_in" boolean DEFAULT false NOT NULL,
        "is_active" boolean DEFAULT true NOT NULL,
        "tool_access" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "schedule_type" text DEFAULT 'none' NOT NULL,
        "schedule_time" text,
        "schedule_day" integer,
        "schedule_interval" integer,
        "next_run_at" timestamp,
        "last_run_at" timestamp,
        "last_scheduled_run_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "provider" text NOT NULL,
        "state" text NOT NULL,
        "code_verifier" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "expires_at" timestamp NOT NULL,
        CONSTRAINT "oauth_states_state_unique" UNIQUE("state")
);
--> statement-breakpoint
CREATE TABLE "tool_connections" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "tool_name" text NOT NULL,
        "credential_type" text NOT NULL,
        "encrypted_credentials" text NOT NULL,
        "encrypted_dek" text NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "scopes" jsonb,
        "metadata" jsonb,
        "last_used_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
        "id" text PRIMARY KEY NOT NULL,
        "referrer_user_id" text NOT NULL,
        "referred_user_id" text NOT NULL,
        "referral_code" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "reward_type" text,
        "reward_applied" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "referrals_referred_user_id_unique" UNIQUE("referred_user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "event_type" text NOT NULL,
        "metadata" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_referral_codes" (
        "user_id" text PRIMARY KEY NOT NULL,
        "referral_code" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "user_referral_codes_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "user_subscriptions" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "plan_id" text DEFAULT 'free' NOT NULL,
        "stripe_customer_id" text,
        "stripe_subscription_id" text,
        "period_start" timestamp DEFAULT now() NOT NULL,
        "period_end" timestamp NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "user_subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "type" text NOT NULL,
        "amount_pence" integer NOT NULL,
        "description" text NOT NULL,
        "metadata" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "balance_pence" integer DEFAULT 0 NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "team_activity" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "user_id" text NOT NULL,
        "action" text NOT NULL,
        "details" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_invites" (
        "id" text PRIMARY KEY NOT NULL,
        "code" text NOT NULL,
        "business_id" text NOT NULL,
        "role" text DEFAULT 'viewer' NOT NULL,
        "email" text,
        "invited_by" text NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "expires_at" timestamp NOT NULL,
        "accepted_by" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "team_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "role" text DEFAULT 'viewer' NOT NULL,
        "invited_by" text,
        "display_name" text,
        "status" text DEFAULT 'active' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "team_members_unique" UNIQUE("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "contact_list_members" (
        "list_id" text NOT NULL,
        "contact_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_lists" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "contact_count" text DEFAULT '0' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "phone" text,
        "email" text,
        "tags" jsonb DEFAULT '[]'::jsonb,
        "consent_given" boolean DEFAULT false NOT NULL,
        "consent_at" timestamp,
        "dnc_listed" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_messages" (
        "id" text PRIMARY KEY NOT NULL,
        "campaign_id" text NOT NULL,
        "contact_id" text,
        "status" text DEFAULT 'pending' NOT NULL,
        "sent_at" timestamp,
        "delivered_at" timestamp,
        "cost" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "type" text DEFAULT 'sms' NOT NULL,
        "list_id" text,
        "message_template" text,
        "status" text DEFAULT 'draft' NOT NULL,
        "scheduled_start" timestamp,
        "calling_hours_start" text,
        "calling_hours_end" text,
        "timezone" text DEFAULT 'Europe/London' NOT NULL,
        "budget_cap_pence" integer,
        "budget_spent_pence" integer DEFAULT 0 NOT NULL,
        "pacing_per_minute" integer,
        "sent_count" integer DEFAULT 0 NOT NULL,
        "delivered_count" integer DEFAULT 0 NOT NULL,
        "failed_count" integer DEFAULT 0 NOT NULL,
        "replied_count" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "agent_activity" boolean DEFAULT true NOT NULL,
        "communications" boolean DEFAULT true NOT NULL,
        "billing_alerts" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "notif_prefs_user_business" UNIQUE("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "token" text NOT NULL,
        "platform" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "push_tokens_user_token" UNIQUE("user_id","token")
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
        "id" text PRIMARY KEY NOT NULL,
        "document_id" text NOT NULL,
        "business_id" text NOT NULL,
        "content" text NOT NULL,
        "embedding" text,
        "chunk_index" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "title" text NOT NULL,
        "status" text DEFAULT 'processing' NOT NULL,
        "chunk_count" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "role" text NOT NULL,
        "content" text NOT NULL,
        "token_count" integer,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mode_sessions" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "mode" text NOT NULL,
        "current_step" integer DEFAULT 0 NOT NULL,
        "total_steps" integer NOT NULL,
        "status" text DEFAULT 'active' NOT NULL,
        "context" text,
        "completed_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
        "id" text PRIMARY KEY NOT NULL,
        "business_id" text NOT NULL,
        "user_id" text NOT NULL,
        "framework" text NOT NULL,
        "prompt" text NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "display_name" text,
        "email" text,
        "country" text,
        "account_type" text,
        "intent" text,
        "background" text,
        "toc_accepted_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "network_connections" (
        "id" text PRIMARY KEY NOT NULL,
        "requester_user_id" text NOT NULL,
        "requester_business_id" text NOT NULL,
        "receiver_user_id" text NOT NULL,
        "receiver_business_id" text NOT NULL,
        "status" text DEFAULT 'pending_qualification' NOT NULL,
        "opportunity_type" text NOT NULL,
        "handoff_mode" text,
        "match_id" text,
        "agent_recommendation" text,
        "qualification_summary" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_followups" (
        "id" text PRIMARY KEY NOT NULL,
        "connection_id" text NOT NULL,
        "user_id" text NOT NULL,
        "prompt_text" text NOT NULL,
        "scheduled_at" timestamp NOT NULL,
        "completed_at" timestamp,
        "is_draft" boolean DEFAULT false NOT NULL,
        "draft_content" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_matches" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "matched_business_id" text NOT NULL,
        "matched_user_id" text NOT NULL,
        "similarity_score" integer DEFAULT 0 NOT NULL,
        "match_reason" text,
        "opportunity_type" text NOT NULL,
        "expires_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_profiles" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL,
        "business_id" text NOT NULL,
        "gdpr_consent_at" timestamp,
        "is_opted_in" boolean DEFAULT false NOT NULL,
        "is_paid_access" boolean DEFAULT false NOT NULL,
        "opportunity_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "sector_preferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
        "deal_breakers" text,
        "must_haves" text,
        "embedding" vector(1536),
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "network_profiles_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "network_qualification_logs" (
        "id" text PRIMARY KEY NOT NULL,
        "connection_id" text NOT NULL,
        "turn" integer DEFAULT 1 NOT NULL,
        "agent_question" text NOT NULL,
        "user_response" text,
        "tokens_cost" integer DEFAULT 0 NOT NULL,
        "is_complete" boolean DEFAULT false NOT NULL,
        "agent_recommendation" text,
        "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_otps" ADD CONSTRAINT "email_otps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_preferences" ADD CONSTRAINT "voice_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telnyx_configs" ADD CONSTRAINT "telnyx_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_pending_actions" ADD CONSTRAINT "agent_pending_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_referral_codes" ADD CONSTRAINT "user_referral_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_activity" ADD CONSTRAINT "team_activity_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_list_members" ADD CONSTRAINT "contact_list_members_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lists" ADD CONSTRAINT "contact_lists_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_list_id_contact_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."contact_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mode_sessions" ADD CONSTRAINT "mode_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mode_sessions" ADD CONSTRAINT "mode_sessions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_requester_business_id_businesses_id_fk" FOREIGN KEY ("requester_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_receiver_user_id_users_id_fk" FOREIGN KEY ("receiver_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_connections" ADD CONSTRAINT "network_connections_receiver_business_id_businesses_id_fk" FOREIGN KEY ("receiver_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_followups" ADD CONSTRAINT "network_followups_connection_id_network_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."network_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_followups" ADD CONSTRAINT "network_followups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_matches" ADD CONSTRAINT "network_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_matches" ADD CONSTRAINT "network_matches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_matches" ADD CONSTRAINT "network_matches_matched_business_id_businesses_id_fk" FOREIGN KEY ("matched_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_matches" ADD CONSTRAINT "network_matches_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_profiles" ADD CONSTRAINT "network_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_profiles" ADD CONSTRAINT "network_profiles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_qualification_logs" ADD CONSTRAINT "network_qualification_logs_connection_id_network_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."network_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_otps_user_idx" ON "email_otps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_otps_email_idx" ON "email_otps" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_tokens_user_idx" ON "user_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_device_id_idx" ON "users" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "businesses_user_id_idx" ON "businesses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "businesses_user_active_idx" ON "businesses" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_provider_idx" ON "api_keys" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "agent_logs_agent_id_idx" ON "agent_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_logs_user_id_idx" ON "agent_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_logs_business_id_idx" ON "agent_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "agent_logs_created_at_idx" ON "agent_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pending_actions_user_idx" ON "agent_pending_actions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "pending_actions_business_idx" ON "agent_pending_actions" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "agents_user_id_idx" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agents_business_id_idx" ON "agents" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "agents_next_run_idx" ON "agents" USING btree ("next_run_at","is_active");--> statement-breakpoint
CREATE INDEX "tool_connections_user_idx" ON "tool_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tool_connections_user_tool_idx" ON "tool_connections" USING btree ("user_id","tool_name");--> statement-breakpoint
CREATE INDEX "usage_events_user_idx" ON "usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_business_idx" ON "usage_events" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "usage_events_type_idx" ON "usage_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "wallet_tx_user_idx" ON "wallet_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "team_activity_business_idx" ON "team_activity" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "team_invites_business_idx" ON "team_invites" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "team_members_business_idx" ON "team_members" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "team_members_user_idx" ON "team_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contact_list_members_list_idx" ON "contact_list_members" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "contact_lists_business_idx" ON "contact_lists" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "contacts_business_idx" ON "contacts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "contacts_phone_idx" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "campaign_messages_campaign_idx" ON "campaign_messages" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_business_idx" ON "campaigns" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_doc_idx" ON "knowledge_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_business_idx" ON "knowledge_chunks" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "knowledge_docs_business_idx" ON "knowledge_documents" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "conversations_user_business_idx" ON "conversations" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mode_sessions_user_idx" ON "mode_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "mode_sessions_business_idx" ON "mode_sessions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "strategies_business_idx" ON "strategies" USING btree ("business_id","framework");--> statement-breakpoint
CREATE INDEX "strategies_user_idx" ON "strategies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_profiles_user_id_idx" ON "user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "network_connections_requester_idx" ON "network_connections" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "network_connections_receiver_idx" ON "network_connections" USING btree ("receiver_user_id");--> statement-breakpoint
CREATE INDEX "network_connections_status_idx" ON "network_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "network_followups_connection_idx" ON "network_followups" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "network_followups_user_idx" ON "network_followups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "network_followups_scheduled_idx" ON "network_followups" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "network_matches_user_idx" ON "network_matches" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "network_matches_matched_idx" ON "network_matches" USING btree ("matched_business_id");--> statement-breakpoint
CREATE INDEX "network_profiles_user_id_idx" ON "network_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "network_profiles_business_id_idx" ON "network_profiles" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "network_qual_logs_connection_idx" ON "network_qualification_logs" USING btree ("connection_id");