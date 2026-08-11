const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/auth');
const { authenticate } = require('../middleware/auth');
const {
  validateRegister, validateVerification, validateLogin, validateResetPassword, validateChangePassword,
} = require('../middleware/validate');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later.' },
});

router.post('/register', authLimiter, validateRegister, ctrl.initiateRegister);
router.post('/register/verify', authLimiter, validateVerification, ctrl.verifyRegistration);
router.post('/login', authLimiter, validateLogin, ctrl.login);
router.post('/logout', ctrl.logout);
router.get('/me', ctrl.me);
router.post('/forgot-password', authLimiter, ctrl.forgotPassword);
router.post('/reset-password', authLimiter, validateResetPassword, ctrl.resetPassword);
router.post('/change-password', authenticate, validateChangePassword, ctrl.changePassword);

module.exports = router;
