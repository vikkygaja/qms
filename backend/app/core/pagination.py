from dataclasses import dataclass
from typing import Any

from fastapi import Query


@dataclass
class PageParams:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)) -> PageParams:
    return PageParams(page, page_size)


def page_of(items: list[Any], total: int, p: PageParams) -> dict:
    return {"items": items, "total": total, "page": p.page, "page_size": p.page_size}
