from datetime import date, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def today_ist(now: datetime) -> date:
    """The hospital's calendar date (Asia/Kolkata) for a UTC instant."""
    return now.astimezone(IST).date()
