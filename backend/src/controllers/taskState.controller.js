const pool = require('../db/pool');

const getTaskState = async (req, res) => {
  try {
    const result = await pool.query('SELECT task_id, done, script, hook FROM task_state');
    const state = {};
    result.rows.forEach(row => {
      state[row.task_id] = {
        done: row.done,
        script: row.script,
        hook: row.hook
      };
    });
    res.json(state);
  } catch (error) {
    console.error('Error fetching task state:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateTaskState = async (req, res) => {
  const { taskId } = req.params;
  const { done, script, hook } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: 'Missing taskId' });
  }

  let updateFields = [];
  let values = [taskId];
  let valueIndex = 2;

  if (done !== undefined) {
    updateFields.push(`done = $${valueIndex++}`);
    values.push(Boolean(done));
  }
  if (script !== undefined) {
    updateFields.push(`script = $${valueIndex++}`);
    values.push(String(script));
  }
  if (hook !== undefined) {
    updateFields.push(`hook = $${valueIndex++}`);
    values.push(String(hook));
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updateFields.push(`updated_at = now()`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Check if exists
    const check = await client.query('SELECT 1 FROM task_state WHERE task_id = $1', [taskId]);
    
    if (check.rowCount > 0) {
      // Update
      const updateQuery = `UPDATE task_state SET ${updateFields.join(', ')} WHERE task_id = $1`;
      await client.query(updateQuery, values);
    } else {
      // Insert with defaults for missing fields
      const insertDone = done !== undefined ? Boolean(done) : false;
      const insertScript = script !== undefined ? String(script) : '';
      const insertHook = hook !== undefined ? String(hook) : '';
      await client.query(
        'INSERT INTO task_state (task_id, done, script, hook) VALUES ($1, $2, $3, $4)',
        [taskId, insertDone, insertScript, insertHook]
      );
    }
    
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating task state:', error);
    if (error.code === '23503') {
      res.status(404).json({ error: 'Task not found in task_config' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  } finally {
    client.release();
  }
};

module.exports = {
  getTaskState,
  updateTaskState
};
