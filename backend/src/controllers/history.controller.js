const pool = require('../db/pool');

const getHistory = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM history_weeks ORDER BY week_key DESC');
    const history = {};
    result.rows.forEach(row => {
      const weekKeyStr = new Date(row.week_key).toISOString().slice(0, 10);
      history[weekKeyStr] = {
        savedAt: new Date(row.saved_at).getTime(),
        totalDone: row.total_done,
        totalTasks: row.total_tasks,
        perChannel: row.per_channel
      };
    });
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const archiveCurrentWeek = async (req, res) => {
  const { weekKey, totalDone, totalTasks, perChannel } = req.body;
  
  if (!weekKey || totalTasks === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    await pool.query(
      `INSERT INTO history_weeks (week_key, total_done, total_tasks, per_channel, saved_at) 
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (week_key) DO UPDATE SET
       total_done = EXCLUDED.total_done,
       total_tasks = EXCLUDED.total_tasks,
       per_channel = EXCLUDED.per_channel,
       saved_at = EXCLUDED.saved_at`,
      [weekKey, totalDone, totalTasks, perChannel]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Error archiving week:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getHistory,
  archiveCurrentWeek
};
