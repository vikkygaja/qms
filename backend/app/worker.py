"""RQ worker entrypoint (stub for Slice 1): `python -m app.worker`.

Real jobs (alerts, reports, email) arrive in Slices 7-8.
"""

from redis import Redis
from rq import Queue, Worker

from app.core.config import get_settings

QUEUES = ["default"]


def main() -> None:
    connection = Redis.from_url(get_settings().redis_url)
    Worker([Queue(name, connection=connection) for name in QUEUES], connection=connection).work()


if __name__ == "__main__":
    main()
