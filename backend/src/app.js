const express = require('express');
const cors = require('cors');
const path = require('path');

const taskConfigRoutes = require('./routes/taskConfig.routes');
const taskStateRoutes = require('./routes/taskState.routes');
const historyRoutes = require('./routes/history.routes');
const authRoutes = require('./routes/auth.routes');
const resetRoutes = require('./routes/reset.routes');

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/task-config', taskConfigRoutes);
app.use('/api/task-state', taskStateRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reset', resetRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve frontend in production (or simply serve the static file if needed)
app.use(express.static(path.join(__dirname, '../../frontend')));

module.exports = app;
