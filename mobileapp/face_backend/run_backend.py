"""Foreground development supervisor. Never widens port visibility or daemonizes."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def supervise(command, *, environment=None, max_restarts=3, delay=2, launch=subprocess.Popen, sleep=time.sleep):
    stopping = False
    child = None
    def stop(signum, _frame):
        nonlocal stopping
        stopping = True
        print(f'Backend supervisor stopping: signal={signum}', flush=True)
        if child and child.poll() is None:
            child.terminate()
    old = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        for attempt in range(max_restarts + 1):
            print(f'Backend supervisor starting worker: attempt={attempt+1}', flush=True)
            child = launch(command, env=environment)
            code = child.wait()
            print(f'Backend worker exited: code={code}', flush=True)
            if stopping or code == 0:
                return code
            if attempt == max_restarts:
                print('Restart limit reached. Fix the reported startup/runtime error and restart the terminal command.', flush=True)
                return code
            sleep(delay)
        return 1
    finally:
        if child and child.poll() is None:
            child.terminate()
            try: child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        for sig, handler in old.items(): signal.signal(sig, handler)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    env = os.environ.copy()
    # Bound inference thread pools on shared development machines.
    env.setdefault('OMP_NUM_THREADS', '2')
    env.setdefault('OPENBLAS_NUM_THREADS', '2')
    env.setdefault('TF_NUM_INTRAOP_THREADS', '2')
    env.setdefault('TF_NUM_INTEROP_THREADS', '2')
    sys.exit(supervise([sys.executable, '-u', str(Path(__file__).with_name('server.py')), '--host', args.host, '--port', str(args.port)], environment=env))
