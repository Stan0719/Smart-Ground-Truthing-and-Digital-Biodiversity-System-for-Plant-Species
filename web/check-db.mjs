
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dbPath = resolve('server/data/auth.sqlite');
console.log('Database path:', dbPath);

try {
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all();

  console.log('Tables:', tables);

  const admin = db
    .prepare(
      'SELECT id, name, email, role, status FROM users WHERE lower(email) = ?',
    )
    .all('admin@niah.com');

  const officer = db
    .prepare(
        'SELECT id, name, email, role, status FROM users WHERE lower(email) = ?',
    )
    .all('officer@niah.com');

    console.log('Admin account:', admin);
    console.log('Officer account:', officer);
  db.close();
} catch (error) {
  console.error('Database check failed:', error.message);
}
