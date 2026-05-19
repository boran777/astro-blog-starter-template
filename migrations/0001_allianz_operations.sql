CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  producer TEXT NOT NULL,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Beklemede',
  priority TEXT NOT NULL DEFAULT 'Orta',
  due_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  update_text TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'Güncelleme',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  customer TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Açık',
  priority TEXT NOT NULL DEFAULT 'Orta',
  opened_date TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks (owner);
CREATE INDEX IF NOT EXISTS idx_task_updates_task_id ON task_updates (task_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_owner ON cases (owner);
