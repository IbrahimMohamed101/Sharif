const express = require('express');
const router = express.Router();
const historyController = require('../controllers/history.controller');
const { requirePassword } = require('../middleware/auth');

router.get('/', historyController.getHistory);
router.post('/archive', requirePassword, historyController.archiveCurrentWeek);

module.exports = router;
