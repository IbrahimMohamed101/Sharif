const pool = require('../db/pool');

const resetAll = async (req, res) => {
  const { weekKey, totalDone, totalTasks, perChannel } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Only archive if there are tasks
    if (weekKey && totalTasks > 0) {
      await client.query(
        `INSERT INTO history_weeks (week_key, total_done, total_tasks, per_channel, saved_at) 
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (week_key) DO UPDATE SET
         total_done = EXCLUDED.total_done,
         total_tasks = EXCLUDED.total_tasks,
         per_channel = EXCLUDED.per_channel,
         saved_at = EXCLUDED.saved_at`,
        [weekKey, totalDone, totalTasks, perChannel]
      );
    }

    // Reset task state
    await client.query('DELETE FROM task_state');

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in reset:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

module.exports = { resetAll };
