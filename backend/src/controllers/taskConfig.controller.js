const pool = require('../db/pool');

const getTaskConfig = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM task_config ORDER BY day_index, sort_order');
    const rows = result.rows;

    const configMap = new Map();

    rows.forEach(row => {
      if (!configMap.has(row.day_index)) {
        configMap.set(row.day_index, {
          name: row.day_name,
          tasks: []
        });
      }
      configMap.get(row.day_index).tasks.push({
        id: row.id,
        channel: row.channel,
        label: row.label
      });
    });

    const taskConfig = Array.from(configMap.values());
    res.json(taskConfig);
  } catch (error) {
    console.error('Error fetching task config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateTaskConfig = async (req, res) => {
  const taskConfig = req.body.taskConfig;
  
  if (!Array.isArray(taskConfig)) {
    return res.status(400).json({ error: 'Invalid taskConfig format' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Remove old config
    await client.query('DELETE FROM task_config');

    // Insert new config
    let dayIndex = 0;
    for (const day of taskConfig) {
      let sortOrder = 0;
      for (const task of day.tasks) {
        if (!task.id || !task.channel || !task.label) {
          throw new Error('Invalid task item');
        }
        await client.query(
          'INSERT INTO task_config (id, day_index, day_name, channel, label, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
          [task.id, dayIndex, day.name, task.channel, task.label, sortOrder]
        );
        sortOrder++;
      }
      dayIndex++;
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating task config:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

module.exports = {
  getTaskConfig,
  updateTaskConfig
};
