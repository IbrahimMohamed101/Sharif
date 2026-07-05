const express = require('express');
const router = express.Router();
const taskStateController = require('../controllers/taskState.controller');

router.get('/', taskStateController.getTaskState);
router.patch('/:taskId', taskStateController.updateTaskState);

module.exports = router;
