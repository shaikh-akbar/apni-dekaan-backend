-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'NET_BANKING', 'WALLET', 'OTHER');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoyaltyAction" AS ENUM ('COUNT_ADDED', 'COUNT_REMOVED', 'COUNT_ADJUSTED', 'REWARD_UNLOCKED', 'REWARD_REVOKED', 'GOLD_UPGRADE', 'GOLD_DOWNGRADE');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('GIFT', 'VOUCHER', 'DISCOUNT', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerRewardStatus" AS ENUM ('AVAILABLE', 'CLAIMED', 'DELIVERED', 'CANCELLED', 'REVOKED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "group" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(190) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "customer_code" VARCHAR(20),
    "full_name" VARCHAR(120) NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "email" VARCHAR(190),
    "date_of_birth" DATE,
    "gender" "Gender",
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "pincode" VARCHAR(10),
    "profile_photo" VARCHAR(255),
    "registration_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "silver_count" INTEGER NOT NULL DEFAULT 0,
    "card_type" "CardType" NOT NULL DEFAULT 'SILVER',
    "total_spent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_purchases" INTEGER NOT NULL DEFAULT 0,
    "eligible_purchases" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" SERIAL NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_purchases" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "final_amount" DECIMAL(12,2) NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "is_eligible" BOOLEAN NOT NULL DEFAULT true,
    "silver_count_earned" INTEGER NOT NULL DEFAULT 0,
    "rule_min_amount" DECIMAL(12,2) NOT NULL,
    "rule_multiple" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(1000),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancel_reason" VARCHAR(500),
    "cancelled_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" INTEGER NOT NULL,
    "updated_by_id" INTEGER,
    "cancelled_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "line_total" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "action" "LoyaltyAction" NOT NULL,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "previous_count" INTEGER NOT NULL,
    "new_count" INTEGER NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "purchase_id" INTEGER,
    "invoice_number" VARCHAR(50),
    "admin_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(1000),
    "required_count" INTEGER NOT NULL,
    "reward_type" "RewardType" NOT NULL DEFAULT 'GIFT',
    "reward_value" DECIMAL(12,2),
    "image" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_rewards" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "reward_id" INTEGER NOT NULL,
    "milestone" INTEGER NOT NULL,
    "status" "CustomerRewardStatus" NOT NULL DEFAULT 'AVAILABLE',
    "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "processed_by_id" INTEGER,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_cards" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "card_number" VARCHAR(30) NOT NULL,
    "card_type" "CardType" NOT NULL DEFAULT 'GOLD',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "upgraded_at" TIMESTAMP(3) NOT NULL,
    "benefits" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "program_name" VARCHAR(120) NOT NULL DEFAULT 'Apni Dukaan Rewards',
    "min_purchase_amount" DECIMAL(12,2) NOT NULL DEFAULT 500,
    "multiple_counts_per_purchase" BOOLEAN NOT NULL DEFAULT false,
    "max_counts_per_purchase" INTEGER NOT NULL DEFAULT 10,
    "gold_threshold" INTEGER NOT NULL DEFAULT 100,
    "gold_benefits" TEXT,
    "shop_name" VARCHAR(120) NOT NULL DEFAULT 'Apni Dukaan',
    "shop_logo" VARCHAR(255),
    "contact_phone" VARCHAR(20),
    "contact_email" VARCHAR(190),
    "contact_address" VARCHAR(500),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "currency_symbol" VARCHAR(5) NOT NULL DEFAULT '₹',
    "updated_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "admin_id" INTEGER,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" INTEGER,
    "action" VARCHAR(80) NOT NULL,
    "entity" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(50),
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_role_id_idx" ON "admin_users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_customer_code_key" ON "customers"("customer_code");

-- CreateIndex
CREATE UNIQUE INDEX "customers_mobile_key" ON "customers"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_full_name_idx" ON "customers"("full_name");

-- CreateIndex
CREATE INDEX "customers_card_type_idx" ON "customers"("card_type");

-- CreateIndex
CREATE INDEX "customers_silver_count_idx" ON "customers"("silver_count");

-- CreateIndex
CREATE INDEX "customers_registration_date_idx" ON "customers"("registration_date");

-- CreateIndex
CREATE INDEX "otp_codes_mobile_purpose_created_at_idx" ON "otp_codes"("mobile", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_purchases_invoice_number_key" ON "customer_purchases"("invoice_number");

-- CreateIndex
CREATE INDEX "customer_purchases_customer_id_idx" ON "customer_purchases"("customer_id");

-- CreateIndex
CREATE INDEX "customer_purchases_purchase_date_idx" ON "customer_purchases"("purchase_date");

-- CreateIndex
CREATE INDEX "customer_purchases_payment_method_idx" ON "customer_purchases"("payment_method");

-- CreateIndex
CREATE INDEX "customer_purchases_status_idx" ON "customer_purchases"("status");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_customer_id_created_at_idx" ON "loyalty_transactions"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_purchase_id_idx" ON "loyalty_transactions"("purchase_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_action_idx" ON "loyalty_transactions"("action");

-- CreateIndex
CREATE INDEX "loyalty_transactions_created_at_idx" ON "loyalty_transactions"("created_at");

-- CreateIndex
CREATE INDEX "rewards_required_count_idx" ON "rewards"("required_count");

-- CreateIndex
CREATE INDEX "rewards_is_active_idx" ON "rewards"("is_active");

-- CreateIndex
CREATE INDEX "customer_rewards_reward_id_idx" ON "customer_rewards"("reward_id");

-- CreateIndex
CREATE INDEX "customer_rewards_status_idx" ON "customer_rewards"("status");

-- CreateIndex
CREATE INDEX "customer_rewards_unlocked_at_idx" ON "customer_rewards"("unlocked_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_rewards_customer_id_reward_id_key" ON "customer_rewards"("customer_id", "reward_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_cards_customer_id_key" ON "membership_cards"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_cards_card_number_key" ON "membership_cards"("card_number");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_purchases" ADD CONSTRAINT "customer_purchases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_purchases" ADD CONSTRAINT "customer_purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_purchases" ADD CONSTRAINT "customer_purchases_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_purchases" ADD CONSTRAINT "customer_purchases_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "customer_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "customer_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_rewards" ADD CONSTRAINT "customer_rewards_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_rewards" ADD CONSTRAINT "customer_rewards_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_rewards" ADD CONSTRAINT "customer_rewards_processed_by_id_fkey" FOREIGN KEY ("processed_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_cards" ADD CONSTRAINT "membership_cards_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Browser clients must use the Express API, not Supabase table access.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rewards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_rewards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loyalty_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
