"""A small in-process sliding-window limiter (per server process; enough for one API instance behind the Vite proxy)."""
import threading
import time
from collections import defaultdict, deque

_lock = threading.Lock()
_hits = defaultdict(deque)


def _prune(q, window, now):
    while q and now - q[0] > window:
        q.popleft()


def count(key, window):
    with _lock:
        q = _hits[key]
        _prune(q, window, time.time())
        return len(q)


def hit(key, window):
    with _lock:
        q = _hits[key]
        now = time.time()
        _prune(q, window, now)
        q.append(now)
        return len(q)


def clear(key):
    with _lock:
        _hits.pop(key, None)


def reset_all():
    with _lock:
        _hits.clear()
