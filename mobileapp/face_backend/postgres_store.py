"""Private PostgreSQL face storage. No schema creation or SQLite fallback at runtime."""
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit, parse_qs

TABLES = ('accounts', 'sessions', 'challenges', 'real_face_templates',
          'face_account_links', 'legacy_face_replacements')


def load_face_environment():
    """Reuse Node's private env-file precedence; capture credentials, never log them."""
    root = Path(__file__).resolve().parents[2]
    script = """
import {loadServerEnvironment} from './web/server/postgres.mjs';
try {
 loadServerEnvironment();
 const keys=['FACE_DATABASE_URL','DATABASE_URL','FACE_PG_SCHEMA','AUTH_PG_SCHEMA',
 'PGSSLROOTCERT','FACE_ACCOUNT_SERVICE_URL','FACE_ACCOUNT_SERVICE_KEY_FILE'];
 process.stdout.write(JSON.stringify(Object.fromEntries(keys.filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))));
} catch { process.exitCode=1; }
"""
    try:
        result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=root,
                                capture_output=True, text=True, timeout=15, check=True)
        settings = json.loads(result.stdout)
        if not isinstance(settings, dict):
            raise ValueError()
        for key, value in settings.items():
            os.environ.setdefault(key, value)
    except (OSError, ValueError, subprocess.SubprocessError):
        raise RuntimeError('Could not load private face database configuration. No connection details were logged.') from None


def parameters(statement):
    """Translate existing bound '?' parameters, preserving quoted SQL literals."""
    output = []
    quoted = False
    index = 0
    while index < len(statement):
        char = statement[index]
        if char == "'":
            output.append(char)
            if quoted and index + 1 < len(statement) and statement[index + 1] == "'":
                output.append("'")
                index += 2
                continue
            quoted = not quoted
        elif char == '?' and not quoted:
            output.append('%s')
        elif char == '%':
            output.append('%%')
        else:
            output.append(char)
        index += 1
    return ''.join(output)


class PostgresStore:
    dialect = 'postgresql'

    def __init__(self, connection, schema):
        if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', schema):
            raise ValueError('Invalid private face schema name.')
        self.connection = connection
        self.schema = schema
        self.in_transaction = False
        self.depth = 0

    def _begin(self):
        if not self.in_transaction:
            self.connection.execute('BEGIN')
            self.in_transaction = True
            try:
                # Poolers may discard startup options and session settings. Bind the
                # schema to the same transaction as every read/write instead.
                self.connection.execute(f'SET LOCAL search_path TO "{self.schema}", pg_catalog')
            except Exception:
                self.rollback()
                raise

    def execute(self, statement, values=()):
        standalone_read = (not self.in_transaction and self.depth == 0
                           and re.match(r'^\s*(SELECT|SHOW)\b', statement, re.I))
        try:
            self._begin()
            result = self.connection.execute(parameters(statement), tuple(values))
            # Regular psycopg cursors buffer their results and remain readable after
            # commit. Avoid idle read transactions; retain pending writes until commit.
            if standalone_read:
                self.commit()
            return result
        except Exception:
            self.rollback()
            raise

    def commit(self):
        if self.in_transaction:
            self.connection.execute('COMMIT')
            self.in_transaction = False

    def rollback(self):
        if self.in_transaction:
            self.connection.execute('ROLLBACK')
            self.in_transaction = False

    def __enter__(self):
        self._begin()
        self.depth += 1
        return self

    def __exit__(self, kind, value, traceback):
        self.depth -= 1
        if kind is not None:
            self.rollback()
        elif self.depth == 0:
            self.commit()
        return False

    def close(self):
        try:
            self.rollback()
        finally:
            self.connection.close()


def connect_face_store(env=None, connector=None):
    env = os.environ if env is None else env
    url = env.get('FACE_DATABASE_URL') or env.get('DATABASE_URL')
    schema = env.get('FACE_PG_SCHEMA', 'plant_face')
    if (not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', schema)
            or schema in ('public', 'auth', 'storage', 'extensions', 'information_schema')
            or schema.startswith('pg_') or schema == env.get('AUTH_PG_SCHEMA', 'plant_auth')):
        raise ValueError('Face storage requires a distinct private PostgreSQL schema.')
    try:
        parsed = urlsplit(url or '')
        if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname:
            raise ValueError()
        if {'host', 'hostaddr'} & set(parse_qs(parsed.query)):
            raise ValueError()
    except ValueError:
        raise ValueError('Configure FACE_DATABASE_URL or DATABASE_URL for PostgreSQL face storage.') from None
    if connector is None:
        try:
            import psycopg
        except ImportError:
            raise RuntimeError('Install the face storage dependency from requirements-postgres.txt before PostgreSQL cutover.') from None
        connector = psycopg.connect
    options = dict(autocommit=True, connect_timeout=10, prepare_threshold=None)
    if parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        options['sslmode'] = 'verify-full'
        options['sslrootcert'] = env.get('PGSSLROOTCERT') or 'system'
    if env.get('PGSSLROOTCERT'):
        options['sslrootcert'] = env['PGSSLROOTCERT']
    connection = None
    try:
        connection = connector(url, **options)
        store = PostgresStore(connection, schema)
        # Validate the reviewed schema without creating tables or changing permissions.
        for table in TABLES:
            store.execute(f'SELECT * FROM "{table}" LIMIT 0')
        return store
    except Exception:
        if connection is not None:
            connection.close()
        raise RuntimeError('PostgreSQL face storage is unavailable or its schema is not ready. No SQLite fallback was used.') from None
