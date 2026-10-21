CREATE TYPE "public"."created_via" AS ENUM('website', 'extension', 'api', 'import');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('receivable', 'payable');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'completed', 'failed', 'cancelled', 'partially_paid', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('payment', 'expense', 'income', 'receipt', 'invoice', 'subscription', 'customer', 'vendor', 'refund', 'note', 'other');--> statement-breakpoint
CREATE TYPE "public"."recurring_frequency" AS ENUM('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('manual', 'browser_extension', 'api', 'import');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#b8a4ed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"gstin" text,
	"billing_address" jsonb,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"tax_rate" numeric(7, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"position" numeric(4, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_applied" numeric(18, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"customer_id" uuid,
	"vendor_id" uuid,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"amount_paid" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"outstanding_amount" numeric(18, 2) NOT NULL,
	"notes" text,
	"terms" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "invoice_exactly_one_party" CHECK (num_nonnulls("invoices"."customer_id", "invoices"."vendor_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid,
	"payment_number" text NOT NULL,
	"direction" "payment_direction" NOT NULL,
	"customer_id" uuid,
	"vendor_id" uuid,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"fee_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0.00' NOT NULL,
	"net_amount" numeric(18, 2) NOT NULL,
	"payment_method_id" uuid,
	"category_id" uuid,
	"invoice_id" uuid,
	"transaction_reference" text,
	"utr" text,
	"description" text,
	"notes" text,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"payment_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "payment_at_most_one_party" CHECK (num_nonnulls("payments"."customer_id", "payments"."vendor_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "recurring_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"customer_id" uuid,
	"vendor_id" uuid,
	"payment_method_id" uuid,
	"category_id" uuid,
	"frequency" "recurring_frequency" NOT NULL,
	"custom_interval_days" numeric(6, 0),
	"start_date" date NOT NULL,
	"next_due_date" date NOT NULL,
	"end_date" date,
	"status" "recurring_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"refund_number" text NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'completed' NOT NULL,
	"refund_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"gstin" text,
	"billing_address" jsonb,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" numeric(12, 0) NOT NULL,
	"sha256" text NOT NULL,
	"width" numeric(8, 0),
	"height" numeric(8, 0),
	"content" "bytea" NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"saved_record_id" uuid NOT NULL,
	"selected_text" text NOT NULL,
	"capture_hash" text NOT NULL,
	"extractor_id" text NOT NULL,
	"extractor_version" text NOT NULL,
	"parsed_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"record_type" "record_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"original_text" text,
	"source_type" "source_type" DEFAULT 'manual' NOT NULL,
	"source_url" text,
	"source_domain" text,
	"source_page_title" text,
	"captured_at" timestamp with time zone,
	"created_via" "created_via" DEFAULT 'website' NOT NULL,
	"summary_amount" numeric(18, 2),
	"summary_currency" text,
	"summary_party" text,
	"summary_status" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"previous_values" jsonb,
	"new_values" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extension_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"code_challenge" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_auth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "extension_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "extension_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text DEFAULT 'Chrome Extension' NOT NULL,
	"browser" text,
	"os" text,
	"extension_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" text,
	"response_body" jsonb,
	"resource_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" text NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_organization_id_user_id_role_id_pk" PRIMARY KEY("organization_id","user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_sources" ADD CONSTRAINT "capture_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_sources" ADD CONSTRAINT "capture_sources_saved_record_id_saved_records_id_fk" FOREIGN KEY ("saved_record_id") REFERENCES "public"."saved_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_records" ADD CONSTRAINT "saved_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_records" ADD CONSTRAINT "saved_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_auth_codes" ADD CONSTRAINT "extension_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_auth_codes" ADD CONSTRAINT "extension_auth_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_refresh_tokens" ADD CONSTRAINT "extension_refresh_tokens_session_id_extension_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."extension_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_sessions" ADD CONSTRAINT "extension_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_sessions" ADD CONSTRAINT "extension_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_unique" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_org_name_unique" ON "categories" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_record_unique" ON "customers" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_payments_payment_unique" ON "invoice_payments" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_invoice_idx" ON "invoice_payments" USING btree ("organization_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_unique" ON "invoices" USING btree ("organization_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_record_unique" ON "invoices" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "invoices_org_status_due_idx" ON "invoices" USING btree ("organization_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_org_name_unique" ON "payment_methods" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_number_unique" ON "payments" USING btree ("organization_id","payment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_record_unique" ON "payments" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "payments_org_date_idx" ON "payments" USING btree ("organization_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_org_status_idx" ON "payments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "payments_org_utr_idx" ON "payments" USING btree ("organization_id","utr");--> statement-breakpoint
CREATE INDEX "payments_org_reference_idx" ON "payments" USING btree ("organization_id","transaction_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_record_unique" ON "recurring_payments" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "recurring_org_due_idx" ON "recurring_payments" USING btree ("organization_id","status","next_due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_org_number_unique" ON "refunds" USING btree ("organization_id","refund_number");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_record_unique" ON "refunds" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("organization_id","payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_record_unique" ON "vendors" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "vendors_org_name_idx" ON "vendors" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "attachments_record_idx" ON "attachments" USING btree ("organization_id","saved_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_sources_record_unique" ON "capture_sources" USING btree ("saved_record_id");--> statement-breakpoint
CREATE INDEX "capture_sources_org_hash_idx" ON "capture_sources" USING btree ("organization_id","capture_hash");--> statement-breakpoint
CREATE INDEX "saved_records_org_created_idx" ON "saved_records" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "saved_records_org_type_idx" ON "saved_records" USING btree ("organization_id","record_type");--> statement-breakpoint
CREATE INDEX "saved_records_source_domain_idx" ON "saved_records" USING btree ("organization_id","source_domain");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("organization_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "extension_refresh_session_idx" ON "extension_refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "extension_sessions_user_idx" ON "extension_sessions" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_org_scope_key_unique" ON "idempotency_keys" USING btree ("organization_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_unique" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_unique" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_slug_unique" ON "roles" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_user_name_unique" ON "saved_views" USING btree ("organization_id","user_id","name");--> statement-breakpoint
CREATE INDEX "user_roles_lookup_idx" ON "user_roles" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE INDEX "saved_records_title_trgm_idx" ON "saved_records" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "saved_records_original_text_trgm_idx" ON "saved_records" USING gin ("original_text" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "vendors_name_trgm_idx" ON "vendors" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_money_non_negative" CHECK (
  amount >= 0 AND tax_amount >= 0 AND fee_amount >= 0 AND discount_amount >= 0 AND net_amount >= 0
);
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK (amount > 0);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_valid" CHECK (
  subtotal >= 0 AND tax_amount >= 0 AND discount_amount >= 0 AND total_amount >= 0 AND amount_paid >= 0 AND outstanding_amount >= 0
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_values_valid" CHECK (
  quantity > 0 AND rate >= 0 AND tax_rate >= 0 AND tax_rate <= 100 AND discount_amount >= 0 AND line_total >= 0
);
--> statement-breakpoint
DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'saved_records', 'capture_sources', 'attachments', 'payments', 'refunds',
    'customers', 'vendors', 'categories', 'payment_methods', 'invoices',
    'invoice_items', 'invoice_payments', 'recurring_payments', 'saved_views',
    'audit_logs', 'idempotency_keys'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
      tenant_table
    );
  END LOOP;
END $$;
