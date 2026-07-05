const express = require('express');
const router = express.Router();
const resetController = require('../controllers/reset.controller');
const { requirePassword } = require('../middleware/auth');

router.post('/', requirePassword, resetController.resetAll);

module.exports = router;
