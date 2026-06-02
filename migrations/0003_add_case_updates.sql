CREATE TABLE IF NOT EXISTS case_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  update_text TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT 'Güncelleme',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_updates_case_id ON case_updates (case_id);
