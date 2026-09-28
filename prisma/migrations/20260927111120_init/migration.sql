-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(80) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `group` VARCHAR(50) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` INTEGER NOT NULL,
    `permission_id` INTEGER NOT NULL,

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role_id` INTEGER NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    `token_version` INTEGER NOT NULL DEFAULT 0,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_users_email_key`(`email`),
    INDEX `admin_users_role_id_idx`(`role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_code` VARCHAR(20) NULL,
    `full_name` VARCHAR(120) NOT NULL,
    `mobile` VARCHAR(15) NOT NULL,
    `email` VARCHAR(190) NULL,
    `date_of_birth` DATE NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER') NULL,
    `address` VARCHAR(500) NULL,
    `city` VARCHAR(100) NULL,
    `pincode` VARCHAR(10) NULL,
    `profile_photo` VARCHAR(255) NULL,
    `registration_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `silver_count` INTEGER NOT NULL DEFAULT 0,
    `card_type` ENUM('SILVER', 'GOLD') NOT NULL DEFAULT 'SILVER',
    `total_spent` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total_purchases` INTEGER NOT NULL DEFAULT 0,
    `eligible_purchases` INTEGER NOT NULL DEFAULT 0,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_customer_code_key`(`customer_code`),
    UNIQUE INDEX `customers_mobile_key`(`mobile`),
    INDEX `customers_full_name_idx`(`full_name`),
    INDEX `customers_card_type_idx`(`card_type`),
    INDEX `customers_silver_count_idx`(`silver_count`),
    INDEX `customers_registration_date_idx`(`registration_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `otp_codes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mobile` VARCHAR(15) NOT NULL,
    `purpose` VARCHAR(20) NOT NULL,
    `code_hash` VARCHAR(255) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumed` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `otp_codes_mobile_purpose_created_at_idx`(`mobile`, `purpose`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_purchases` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `invoice_number` VARCHAR(50) NOT NULL,
    `purchase_date` DATETIME(3) NOT NULL,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `final_amount` DECIMAL(12, 2) NOT NULL,
    `payment_method` ENUM('CASH', 'UPI', 'CARD', 'NET_BANKING', 'WALLET', 'OTHER') NOT NULL,
    `is_eligible` BOOLEAN NOT NULL DEFAULT true,
    `silver_count_earned` INTEGER NOT NULL DEFAULT 0,
    `rule_min_amount` DECIMAL(12, 2) NOT NULL,
    `rule_multiple` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(1000) NULL,
    `status` ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `cancel_reason` VARCHAR(500) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `created_by_id` INTEGER NOT NULL,
    `updated_by_id` INTEGER NULL,
    `cancelled_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_purchases_invoice_number_key`(`invoice_number`),
    INDEX `customer_purchases_customer_id_idx`(`customer_id`),
    INDEX `customer_purchases_purchase_date_idx`(`purchase_date`),
    INDEX `customer_purchases_payment_method_idx`(`payment_method`),
    INDEX `customer_purchases_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchase_id` INTEGER NOT NULL,
    `product_name` VARCHAR(200) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit_price` DECIMAL(12, 2) NOT NULL,
    `line_total` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `purchase_items_purchase_id_idx`(`purchase_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loyalty_transactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `action` ENUM('COUNT_ADDED', 'COUNT_REMOVED', 'COUNT_ADJUSTED', 'REWARD_UNLOCKED', 'REWARD_REVOKED', 'GOLD_UPGRADE', 'GOLD_DOWNGRADE') NOT NULL,
    `delta` INTEGER NOT NULL DEFAULT 0,
    `previous_count` INTEGER NOT NULL,
    `new_count` INTEGER NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `purchase_id` INTEGER NULL,
    `invoice_number` VARCHAR(50) NULL,
    `admin_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `loyalty_transactions_customer_id_created_at_idx`(`customer_id`, `created_at`),
    INDEX `loyalty_transactions_purchase_id_idx`(`purchase_id`),
    INDEX `loyalty_transactions_action_idx`(`action`),
    INDEX `loyalty_transactions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rewards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `required_count` INTEGER NOT NULL,
    `reward_type` ENUM('GIFT', 'VOUCHER', 'DISCOUNT', 'SERVICE', 'OTHER') NOT NULL DEFAULT 'GIFT',
    `reward_value` DECIMAL(12, 2) NULL,
    `image` VARCHAR(255) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rewards_required_count_idx`(`required_count`),
    INDEX `rewards_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_rewards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `reward_id` INTEGER NOT NULL,
    `milestone` INTEGER NOT NULL,
    `status` ENUM('AVAILABLE', 'CLAIMED', 'DELIVERED', 'CANCELLED', 'REVOKED') NOT NULL DEFAULT 'AVAILABLE',
    `unlocked_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimed_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `processed_by_id` INTEGER NULL,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_rewards_reward_id_idx`(`reward_id`),
    INDEX `customer_rewards_status_idx`(`status`),
    INDEX `customer_rewards_unlocked_at_idx`(`unlocked_at`),
    UNIQUE INDEX `customer_rewards_customer_id_reward_id_key`(`customer_id`, `reward_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `membership_cards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `card_number` VARCHAR(30) NOT NULL,
    `card_type` ENUM('SILVER', 'GOLD') NOT NULL DEFAULT 'GOLD',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `upgraded_at` DATETIME(3) NOT NULL,
    `benefits` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `membership_cards_customer_id_key`(`customer_id`),
    UNIQUE INDEX `membership_cards_card_number_key`(`card_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loyalty_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `program_name` VARCHAR(120) NOT NULL DEFAULT 'Apni Dukaan Rewards',
    `min_purchase_amount` DECIMAL(12, 2) NOT NULL DEFAULT 500,
    `multiple_counts_per_purchase` BOOLEAN NOT NULL DEFAULT false,
    `max_counts_per_purchase` INTEGER NOT NULL DEFAULT 10,
    `gold_threshold` INTEGER NOT NULL DEFAULT 100,
    `gold_benefits` TEXT NULL,
    `shop_name` VARCHAR(120) NOT NULL DEFAULT 'Apni Dukaan',
    `shop_logo` VARCHAR(255) NULL,
    `contact_phone` VARCHAR(20) NULL,
    `contact_email` VARCHAR(190) NULL,
    `contact_address` VARCHAR(500) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'INR',
    `currency_symbol` VARCHAR(5) NOT NULL DEFAULT '₹',
    `updated_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `admin_id` INTEGER NULL,
    `actor_type` VARCHAR(20) NOT NULL,
    `actor_id` INTEGER NULL,
    `action` VARCHAR(80) NOT NULL,
    `entity` VARCHAR(50) NOT NULL,
    `entity_id` VARCHAR(50) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_entity_id_idx`(`entity`, `entity_id`),
    INDEX `audit_logs_admin_id_idx`(`admin_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `admin_users` ADD CONSTRAINT `admin_users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_purchases` ADD CONSTRAINT `customer_purchases_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_purchases` ADD CONSTRAINT `customer_purchases_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `admin_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_purchases` ADD CONSTRAINT `customer_purchases_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_purchases` ADD CONSTRAINT `customer_purchases_cancelled_by_id_fkey` FOREIGN KEY (`cancelled_by_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `customer_purchases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_transactions` ADD CONSTRAINT `loyalty_transactions_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_transactions` ADD CONSTRAINT `loyalty_transactions_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `customer_purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loyalty_transactions` ADD CONSTRAINT `loyalty_transactions_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_rewards` ADD CONSTRAINT `customer_rewards_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_rewards` ADD CONSTRAINT `customer_rewards_reward_id_fkey` FOREIGN KEY (`reward_id`) REFERENCES `rewards`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_rewards` ADD CONSTRAINT `customer_rewards_processed_by_id_fkey` FOREIGN KEY (`processed_by_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `membership_cards` ADD CONSTRAINT `membership_cards_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
