"""In-memory sliding-window limiter for failed logins, per account and per
client IP. Deliberately in-process: this app runs a single worker by design
(app/main.py), so no shared store is needed — the cost is that a restart
clears it, which is acceptable for a brute-force brake."""
from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable

MAX_KEYS = 10_000


class LoginRateLimiter:
    def __init__(self, max_per_account: int = 8, max_per_ip: int = 30,
                 window_seconds: float = 900.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.max_per_account = max_per_account
        self.max_per_ip = max_per_ip
        self.window = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, key: str) -> deque[float]:
        q = self._failures.get(key)
        if q is None:
            return deque()
        cutoff = self._clock() - self.window
        while q and q[0] <= cutoff:
            q.popleft()
        if not q:
            del self._failures[key]
        return q

    def _retry_after(self, key: str, limit: int) -> int:
        q = self._recent(key)
        if len(q) < limit:
            return 0
        # Allowed again once enough old failures have aged out of the window.
        free_at = q[len(q) - limit] + self.window
        return max(1, int(free_at - self._clock()) + 1)

    def retry_after(self, ip: str | None, username: str) -> int:
        """Seconds until a login attempt is allowed (0 = allowed now)."""
        return max(
            self._retry_after(f"user:{username.lower()}", self.max_per_account),
            self._retry_after(f"ip:{ip}", self.max_per_ip) if ip else 0,
        )

    def record_failure(self, ip: str | None, username: str) -> None:
        if len(self._failures) > MAX_KEYS:
            for key in list(self._failures):
                self._recent(key)
            if len(self._failures) > MAX_KEYS:   # still flooded: shed everything
                self._failures.clear()
        now = self._clock()
        for key in (f"user:{username.lower()}", f"ip:{ip}" if ip else None):
            if key:
                self._failures.setdefault(key, deque()).append(now)

    def record_success(self, username: str) -> None:
        self._failures.pop(f"user:{username.lower()}", None)


limiter = LoginRateLimiter()
