// src/routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');

// Sign up (email verification flow)
router.post('/signup/start', authController.signupStart);
router.get('/verify-email', authController.verifyEmail);
router.get('/signup/status/:token', authController.signupStatus);
router.post('/signup/finalize', authController.signupFinalize);

// ✅ NEW: Login (uses passwordHash + verified check in controller)
router.post('/login', authController.login);

// CRUCIAL: Export the router
module.exports = router;