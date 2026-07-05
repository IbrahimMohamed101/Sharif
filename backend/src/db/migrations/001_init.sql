CREATE TABLE IF NOT EXISTS task_config (
  id            TEXT PRIMARY KEY,
  day_index     INT NOT NULL,
  day_name      TEXT NOT NULL,
  channel       TEXT NOT NULL,
  label         TEXT NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_state (
  task_id       TEXT PRIMARY KEY REFERENCES task_config(id) ON DELETE CASCADE,
  done          BOOLEAN NOT NULL DEFAULT FALSE,
  script        TEXT DEFAULT '',
  hook          TEXT DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS history_weeks (
  week_key      DATE PRIMARY KEY,
  total_done    INT NOT NULL,
  total_tasks   INT NOT NULL,
  per_channel   JSONB NOT NULL,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

-- Insert the hashed password for '2002'
INSERT INTO app_settings (key, value)
VALUES ('action_password_hash', '$2b$10$zdEU.ZXrwLZkokNj18WKeOvKz7PyyN6bv1O8BojwBBY5Ct8Wcct7O')
ON CONFLICT (key) DO NOTHING;

-- Seed default task_config
INSERT INTO task_config (id, day_index, day_name, channel, label, sort_order) VALUES
('d0-t0', 0, 'الجمعة', 'القيادي', 'فيديو 1', 0),
('d0-t1', 0, 'الجمعة', 'القيادي', 'فيديو 2', 1),
('d0-t2', 0, 'الجمعة', 'رائج', 'فيديو ترند', 2),
('d0-t3', 0, 'الجمعة', 'عرب جيمرز', 'فيديو جيمنج', 3),

('d1-t0', 1, 'السبت', 'القيادي', 'فيديو 1', 0),
('d1-t1', 1, 'السبت', 'القيادي', 'فيديو 2', 1),
('d1-t2', 1, 'السبت', 'رائج', 'فيديو ترند', 2),
('d1-t3', 1, 'السبت', 'سائح', 'فيديو سياحي', 3),

('d2-t0', 2, 'الأحد', 'القيادي', 'فيديو 1', 0),
('d2-t1', 2, 'الأحد', 'القيادي', 'فيديو 2', 1),
('d2-t2', 2, 'الأحد', 'رائج', 'فيديو ترند', 2),
('d2-t3', 2, 'الأحد', 'عرب جيمرز', 'فيديو جيمنج', 3),

('d3-t0', 3, 'الإثنين', 'القيادي', 'فيديو 1', 0),
('d3-t1', 3, 'الإثنين', 'القيادي', 'فيديو 2', 1),
('d3-t2', 3, 'الإثنين', 'رائج', 'فيديو ترند', 2),
('d3-t3', 3, 'الإثنين', 'سائح', 'فيديو سياحي', 3),

('d4-t0', 4, 'الثلاثاء', 'القيادي', 'فيديو 1', 0),
('d4-t1', 4, 'الثلاثاء', 'القيادي', 'فيديو 2', 1),
('d4-t2', 4, 'الثلاثاء', 'رائج', 'فيديو ترند', 2),
('d4-t3', 4, 'الثلاثاء', 'عرب جيمرز', 'فيديو جيمنج', 3),

('d5-t0', 5, 'الأربعاء', 'القيادي', 'فيديو 1', 0),
('d5-t1', 5, 'الأربعاء', 'القيادي', 'فيديو 2', 1),
('d5-t2', 5, 'الأربعاء', 'رائج', 'فيديو ترند', 2),
('d5-t3', 5, 'الأربعاء', 'سائح', 'فيديو سياحي', 3)
ON CONFLICT (id) DO NOTHING;
