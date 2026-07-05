const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { requirePassword } = require('../middleware/auth');

router.post('/verify-password', requirePassword, authController.verifyPassword);

module.exports = router;
