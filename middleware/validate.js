const { body, validationResult } = require('express-validator');
const { errorResponse } = require('../utils/helpers');

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return errorResponse(res, errors.array()[0].msg, 422);
  }
  next();
}

const PASSWORD_RULE = body('password')
  .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
  .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
  .matches(/[0-9]/).withMessage('Password must contain a number')
  .matches(/[^A-Za-z0-9]/).withMessage('Password must contain a special character');

const validateRegister = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
  PASSWORD_RULE,
  handleValidation,
];

const validateVerification = [
  body('email').isEmail().normalizeEmail(),
  body('token').isLength({ min: 6, max: 6 }).withMessage('Verification code must be 6 digits'),
  handleValidation,
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('A valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidation,
];

const validateResetPassword = [
  body('token').notEmpty().withMessage('Reset token is required'),
  PASSWORD_RULE,
  handleValidation,
];

const validateChangePassword = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('New password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('New password must contain a number')
    .matches(/[^A-Za-z0-9]/).withMessage('New password must contain a special character'),
  handleValidation,
];

const validatePrediction = [
  body('home_team').trim().notEmpty().withMessage('Home team is required'),
  body('away_team').trim().notEmpty().withMessage('Away team is required'),
  body('match_date').isISO8601().withMessage('A valid match date is required'),
  body('tip').trim().notEmpty().withMessage('Tip is required'),
  handleValidation,
];

const validateBlog = [
  body('title').trim().isLength({ min: 3 }).withMessage('Title is required'),
  handleValidation,
];

const validateComment = [
  body('content').trim().isLength({ min: 1, max: 2000 }).withMessage('Comment must be 1-2000 characters'),
  handleValidation,
];

const validateVoteChoice = [
  body('choice').isIn(['home', 'draw', 'away']).withMessage('Vote choice must be home, draw, or away'),
  handleValidation,
];

module.exports = {
  handleValidation,
  validateRegister,
  validateVerification,
  validateLogin,
  validateResetPassword,
  validateChangePassword,
  validatePrediction,
  validateBlog,
  validateComment,
  validateVoteChoice,
};
