from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import IdMixin, TimestampMixin


class Organization(Base, IdMixin, TimestampMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), unique=True)

    projects: Mapped[list["Project"]] = relationship(back_populates="organization")
    item_types: Mapped[list["ItemType"]] = relationship(back_populates="organization")
    link_types: Mapped[list["LinkType"]] = relationship(back_populates="organization")
