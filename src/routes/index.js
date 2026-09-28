import { Router } from 'express';
import * as adminC from '../controllers/admin.controller.js';
import * as authC from '../controllers/auth.controller.js';
import * as customerC from '../controllers/customer.controller.js';
import * as meC from '../controllers/me.controller.js';
import * as purchaseC from '../controllers/purchase.controller.js';
import * as rewardC from '../controllers/reward.controller.js';
import { enforcePasswordChange, requireAdmin, requireCustomer, requirePermission as can } from '../middleware/auth.js';
import { loginLimiter, otpLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/common.js';
import * as s from '../validators/schemas.js';

const router = Router();
const id = validate({ params: idParam });

// ───────────────────────── Public ─────────────────────────
router.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
router.get('/settings/public', adminC.getPublicSettings);
router.get('/rewards/public', rewardC.listPublic);

// ───────────────────────── Auth ─────────────────────────
router.post('/auth/admin/login', loginLimiter, validate({ body: s.adminLoginBody }), authC.adminLogin);
router.post('/auth/admin/logout', authC.adminLogout);
router.get('/auth/admin/me', requireAdmin, authC.adminMe);
router.post('/auth/admin/change-password', loginLimiter, requireAdmin, validate({ body: s.changePasswordBody }), authC.adminChangePassword);

router.post('/auth/otp', otpLimiter, validate({ body: s.loginOtpBody }), authC.requestLoginOtp);
router.post('/auth/register/otp', otpLimiter, validate({ body: s.registerOtpBody }), authC.requestRegisterOtp);
router.post('/auth/login', loginLimiter, validate({ body: s.customerLoginBody }), authC.customerLogin);
router.post('/auth/register', loginLimiter, validate({ body: s.customerRegisterBody }), authC.customerRegister);
router.post('/auth/logout', authC.customerLogout);

// ───────────────────────── Customer portal (own data only) ─────────────────────────
const me = Router();
me.use(requireCustomer);
me.get('/', meC.overview);
me.put('/', validate({ body: s.selfUpdateBody }), meC.updateProfile);
me.post('/photo', meC.photoField, meC.uploadPhoto);
me.get('/purchases', meC.purchases);
me.get('/loyalty', meC.loyalty);
me.get('/rewards', meC.rewards);
me.post('/rewards/:id/claim', meC.claimReward);
router.use('/me', me);

// ───────────────────────── Admin (auth + RBAC) ─────────────────────────
const admin = Router();
admin.use(requireAdmin, enforcePasswordChange);

admin.get('/dashboard', can('dashboard.view'), adminC.dashboard);

admin.get('/customers', can('customers.view'), validate({ query: s.customerListQuery }), customerC.list);
admin.post('/customers', can('customers.create'), validate({ body: s.customerCreateBody }), customerC.create);
admin.get('/customers/:id', can('customers.view'), id, customerC.get);
admin.put('/customers/:id', can('customers.edit'), validate({ params: idParam, body: s.customerUpdateBody }), customerC.update);
admin.post('/customers/:id/photo', can('customers.edit'), id, customerC.photoUpload, customerC.uploadPhoto);
admin.get('/customers/:id/purchases', can('customers.view', 'purchases.view'), id, customerC.purchases);
admin.get('/customers/:id/loyalty', can('customers.view', 'loyalty.view'), id, customerC.loyalty);
admin.get('/customers/:id/rewards', can('customers.view', 'rewards.view'), id, customerC.rewards);
admin.post('/customers/:id/loyalty/recalculate', can('loyalty.recalculate'), validate({ params: idParam, body: s.recalcBody }), customerC.recalculate);

admin.get('/purchases', can('purchases.view'), validate({ query: s.purchaseListQuery }), purchaseC.list);
admin.post('/purchases', can('purchases.create'), validate({ body: s.purchaseCreateBody }), purchaseC.create);
admin.get('/purchases/:id', can('purchases.view'), id, purchaseC.get);
admin.put('/purchases/:id', can('purchases.edit'), validate({ params: idParam, body: s.purchaseUpdateBody }), purchaseC.update);
admin.delete('/purchases/:id', can('purchases.cancel'), validate({ params: idParam, body: s.purchaseCancelBody }), purchaseC.cancel);
admin.post('/purchases/:id/cancel', can('purchases.cancel'), validate({ params: idParam, body: s.purchaseCancelBody }), purchaseC.cancel);

admin.get('/rewards', can('rewards.view'), rewardC.list);
admin.post('/rewards', can('rewards.manage'), validate({ body: s.rewardCreateBody }), rewardC.create);
admin.get('/rewards/:id', can('rewards.view'), id, rewardC.get);
admin.put('/rewards/:id', can('rewards.manage'), validate({ params: idParam, body: s.rewardUpdateBody }), rewardC.update);
admin.post('/rewards/:id/image', can('rewards.manage'), id, rewardC.imageField, rewardC.uploadImage);

admin.get('/reward-claims', can('rewards.view'), validate({ query: s.claimListQuery }), rewardC.listClaims);
admin.patch('/reward-claims/:id', can('rewards.process'), validate({ params: idParam, body: s.claimStatusBody }), rewardC.setClaimStatus);

admin.get('/loyalty', can('loyalty.view'), validate({ query: s.loyaltyListQuery }), adminC.loyaltyHistory);
admin.post('/loyalty/recalculate', can('loyalty.recalculate'), validate({ body: s.recalcBody }), adminC.recalculateEveryone);

admin.get('/reports/:type', can('reports.view'), validate({ query: s.reportQuery }), adminC.report);

admin.get('/settings/loyalty', can('settings.manage'), adminC.getLoyaltySettings);
admin.put('/settings/loyalty', can('settings.manage'), validate({ body: s.settingsBody }), adminC.putLoyaltySettings);
admin.post('/settings/logo', can('settings.manage'), adminC.logoField, adminC.uploadLogo);

admin.get('/staff', can('staff.manage'), adminC.listAdmins);
admin.post('/staff', can('staff.manage'), validate({ body: s.adminCreateBody }), adminC.createAdmin);
admin.put('/staff/:id', can('staff.manage'), validate({ params: idParam, body: s.adminUpdateBody }), adminC.updateAdmin);
admin.get('/roles', can('staff.manage'), adminC.listRoles);
admin.post('/roles', can('staff.manage'), validate({ body: s.roleCreateBody }), adminC.createRole);
admin.put('/roles/:id', can('staff.manage'), validate({ params: idParam, body: s.roleUpdateBody }), adminC.updateRole);

admin.get('/audit-logs', can('audit.view'), validate({ query: s.auditListQuery }), adminC.auditLogs);

router.use(admin);

export default router;
