const bcrypt = require('bcrypt');
const pool = require('../db/pool');

const requirePassword = async (req, res, next) => {
  const password = req.body.password || req.headers['x-action-password'];

  if (!password) {
    return res.status(401).json({ error: 'Password required' });
  }

  try {
    const result = await pool.query("SELECT value FROM app_settings WHERE key = 'action_password_hash'");
    if (result.rows.length === 0) {
      return res.status(500).json({ error: 'Password hash not found in settings' });
    }

    const hash = result.rows[0].value;
    const match = await bcrypt.compare(password, hash);

    if (!match) {
      return res.status(401).json({ error: 'Invalid password', ok: false });
    }

    next();
  } catch (error) {
    console.error('Error verifying password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { requirePassword };
