import unittest
import re
from unittest.mock import Mock
from postgres_store import PostgresStore, connect_face_store, parameters


class PostgresStoreTests(unittest.TestCase):
    def test_pooler_resets_schema_but_every_read_and_write_reestablishes_it(self):
        connection = Mock()
        state = {'transaction': False, 'face_schema': False}
        def execute(statement, values=()):
            if statement == 'BEGIN':
                state['transaction'] = True
            elif statement.startswith('SET LOCAL search_path'):
                self.assertTrue(state['transaction'])
                state['face_schema'] = True
            elif statement in ('COMMIT', 'ROLLBACK'):
                state.update(transaction=False, face_schema=False)
            else:
                self.assertTrue(state['transaction'])
                self.assertTrue(state['face_schema'], 'Query used the pooler default schema')
            return Mock(fetchone=lambda: (0,))
        connection.execute.side_effect = execute
        store = PostgresStore(connection, 'plant_face')
        for _ in range(2):
            self.assertEqual(store.execute('SELECT COUNT(*) FROM real_face_templates').fetchone(), (0,))
            self.assertFalse(store.in_transaction)
        store.execute('INSERT INTO challenges VALUES(?,?)', ('fixture', 12))
        store.execute('SELECT expires FROM challenges WHERE token=?', ('fixture',))
        self.assertTrue(store.in_transaction)
        store.commit()
        with store:
            store.execute('DELETE FROM challenges WHERE token=?', ('fixture',))
            with store:
                store.execute('SELECT COUNT(*) FROM challenges')
        self.assertFalse(store.in_transaction)
        self.assertEqual(sum(call.args == ('BEGIN',) for call in connection.execute.call_args_list), 4)

    def test_failed_schema_selection_prevents_query_and_rolls_back(self):
        connection = Mock()
        connection.execute.side_effect = [None, RuntimeError('controlled schema failure'), None]
        store = PostgresStore(connection, 'plant_face')
        with self.assertRaises(RuntimeError):
            store.execute('SELECT COUNT(*) FROM real_face_templates')
        self.assertFalse(store.in_transaction)
        self.assertEqual([call.args[0] for call in connection.execute.call_args_list],
                         ['BEGIN', 'SET LOCAL search_path TO "plant_face", pg_catalog', 'ROLLBACK'])
        connection.execute.side_effect = None
        store.execute('SELECT COUNT(*) FROM real_face_templates')
        self.assertFalse(store.in_transaction)

    def test_direct_store_rejects_unsafe_schema_identifiers(self):
        for schema in ['plant_face; DROP SCHEMA public', 'plant_face"', '']:
            with self.assertRaises(ValueError):
                PostgresStore(Mock(), schema)

    def test_parameters_are_bound_not_interpolated(self):
        self.assertEqual(parameters("SELECT '?' AS literal,?,'it''s ?','50%'"),
                         "SELECT '?' AS literal,%s,'it''s ?','50%%'")
        connection = Mock()
        store = PostgresStore(connection, 'plant_face')
        value = "x'); DROP TABLE real_face_templates;--"
        store.execute('SELECT * FROM accounts WHERE email=?', (value,))
        self.assertEqual(connection.execute.call_args_list[2].args,
                         ('SELECT * FROM accounts WHERE email=%s', (value,)))
        self.assertEqual(connection.execute.call_args_list[1].args,
                         ('SET LOCAL search_path TO "plant_face", pg_catalog',))
        self.assertEqual(connection.execute.call_args_list[-1].args, ('COMMIT',))

    def test_writes_commit_and_context_rollback_without_closing_connection(self):
        connection = Mock()
        store = PostgresStore(connection, 'plant_face')
        store.execute('INSERT INTO challenges VALUES(?,?)', ('fixture', 12))
        store.commit()
        self.assertEqual(connection.execute.call_args_list[0].args, ('BEGIN',))
        self.assertEqual(connection.execute.call_args_list[-1].args, ('COMMIT',))
        with self.assertRaises(ValueError):
            with store:
                store.execute('DELETE FROM challenges WHERE token=?', ('fixture',))
                raise ValueError('controlled rollback')
        self.assertEqual(connection.execute.call_args_list[-1].args, ('ROLLBACK',))
        connection.close.assert_not_called()

    def test_database_failure_rolls_back_before_next_request(self):
        connection = Mock()
        store = PostgresStore(connection, 'plant_face')
        store.execute('INSERT INTO challenges VALUES(?,?)', ('fixture', 12))
        connection.execute.side_effect = [RuntimeError('controlled'), None]
        with self.assertRaises(RuntimeError):
            store.execute('DELETE FROM challenges WHERE token=?', ('fixture',))
        self.assertFalse(store.in_transaction)
        self.assertEqual(connection.execute.call_args_list[-1].args, ('ROLLBACK',))

    def test_connection_uses_private_schema_verified_tls_and_no_runtime_ddl(self):
        connection = Mock()
        connector = Mock(return_value=connection)
        store = connect_face_store({'FACE_DATABASE_URL': 'postgresql://user:fixture@db.example.invalid/db'}, connector)
        self.assertEqual(store.dialect, 'postgresql')
        self.assertEqual(connector.call_args.kwargs['sslmode'], 'verify-full')
        self.assertTrue(connector.call_args.kwargs['autocommit'])
        self.assertNotIn('options', connector.call_args.kwargs)
        statements = [call.args[0] for call in connection.execute.call_args_list]
        self.assertEqual(statements.count('BEGIN'), 6)
        self.assertEqual(statements.count('SET LOCAL search_path TO "plant_face", pg_catalog'), 6)
        self.assertEqual(statements.count('COMMIT'), 6)
        self.assertEqual(sum(s.startswith('SELECT ') for s in statements), 6)
        self.assertFalse(any(re.match(r'CREATE|ALTER|DROP|INSERT|UPDATE|DELETE', s) for s in statements))

    def test_bad_configuration_and_missing_schema_fail_without_sqlite(self):
        connector = Mock()
        for settings in [{}, {'FACE_DATABASE_URL': 'sqlite:///auth.sqlite'},
                         {'FACE_DATABASE_URL': 'postgresql://localhost/db', 'FACE_PG_SCHEMA': 'plant_auth'},
                         {'FACE_DATABASE_URL': 'postgresql://localhost/db?host=remote.invalid'}]:
            with self.assertRaises(ValueError):
                connect_face_store(settings, connector)
        connector.assert_not_called()
        connection = Mock()
        connection.execute.side_effect = RuntimeError('private driver details')
        with self.assertRaisesRegex(RuntimeError, 'No SQLite fallback') as caught:
            connect_face_store({'DATABASE_URL': 'postgresql://localhost/db'}, Mock(return_value=connection))
        self.assertNotIn('private driver details', str(caught.exception))
        connection.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
