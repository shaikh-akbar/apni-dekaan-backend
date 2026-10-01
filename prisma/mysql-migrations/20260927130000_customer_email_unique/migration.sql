-- Customer emails are now unique: OTP login codes are sent to this address
CREATE UNIQUE INDEX `customers_email_key` ON `customers`(`email`);
