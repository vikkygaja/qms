import uuid

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import DeclarativeBase, Session, SessionTransaction, sessionmaker


class Base(DeclarativeBase):
    """Declarative base for all models."""


def make_engine(database_url: str) -> Engine:
    return create_engine(
        database_url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 3},
    )


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


_SET_TENANT = text("SELECT set_config('app.tenant_id', :t, true)")


@event.listens_for(Session, "after_begin")
def _apply_tenant(session: Session, _: SessionTransaction, connection: Connection) -> None:
    """Row-level security reads app.tenant_id; re-apply it for every new transaction."""
    tenant_id = session.info.get("tenant_id")
    if tenant_id:
        connection.execute(_SET_TENANT, {"t": str(tenant_id)})


def set_tenant(session: Session, tenant_id: uuid.UUID) -> None:
    session.info["tenant_id"] = tenant_id
    if session.in_transaction():
        session.execute(_SET_TENANT, {"t": str(tenant_id)})
