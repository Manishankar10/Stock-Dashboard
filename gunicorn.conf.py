# Gunicorn production configuration for Capital Desk
# Guarantees long-running financial simulation backtests do not trigger 30s worker timeout

import os

# Worker timeout in seconds (allows multi-year index backtests to complete cleanly)
timeout = 120

# Concurrency
workers = int(os.environ.get("WEB_CONCURRENCY", 2))
threads = 4

# Connection keep-alive
keepalive = 5

# Prevent memory leaks over long sessions
max_requests = 1000
max_requests_jitter = 100
