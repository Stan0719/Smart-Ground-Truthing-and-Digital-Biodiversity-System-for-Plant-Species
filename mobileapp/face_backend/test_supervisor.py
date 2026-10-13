import unittest
from run_backend import supervise

class Child:
    def __init__(self, code): self.code=code
    def wait(self, **kwargs): return self.code
    def poll(self): return self.code

class SupervisorTests(unittest.TestCase):
    def test_unexpected_exit_restarts_then_stops_after_clean_exit(self):
        codes=iter([-11,0]);calls=[]
        def launch(command, **kwargs):
            calls.append(command)
            return Child(next(codes))
        self.assertEqual(supervise(['test-worker'],launch=launch,sleep=lambda _:None),0)
        self.assertEqual(len(calls),2)

    def test_bad_startup_has_bounded_retries(self):
        calls=[]
        def launch(command, **kwargs):
            calls.append(command)
            return Child(1)
        self.assertEqual(supervise(['test-worker'],max_restarts=2,launch=launch,sleep=lambda _:None),1)
        self.assertEqual(len(calls),3)

if __name__ == '__main__': unittest.main()
