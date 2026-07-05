const express = require('express');
const router = express.Router();
const taskConfigController = require('../controllers/taskConfig.controller');
const { requirePassword } = require('../middleware/auth');

router.get('/', taskConfigController.getTaskConfig);
router.put('/', requirePassword, taskConfigController.updateTaskConfig);

module.exports = router;
