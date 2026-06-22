import enum
from uuid import UUID, uuid4
from sqlalchemy import String, Text, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class RelationshipType(str, enum.Enum):
    parent_child = "parent_child"
    partner = "partner"


class EndReason(str, enum.Enum):
    divorce = "divorce"
    death = "death"
    annulment = "annulment"


class Relationship(Base, TimestampMixin):
    __tablename__ = "relationships"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    person_a_id: Mapped[UUID] = mapped_column(
        ForeignKey("persons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    person_b_id: Mapped[UUID] = mapped_column(
        ForeignKey("persons.id", ondelete="CASCADE"), index=True, nullable=False
    )
    type: Mapped[RelationshipType] = mapped_column(SAEnum(RelationshipType), nullable=False)
    start_date: Mapped[str | None] = mapped_column(String(10))
    end_date: Mapped[str | None] = mapped_column(String(10))
    end_reason: Mapped[EndReason | None] = mapped_column(SAEnum(EndReason))
    notes: Mapped[str | None] = mapped_column(Text)

    person_a: Mapped["Person"] = relationship(  # type: ignore[name-defined]
        "Person", foreign_keys=[person_a_id], back_populates="relationships_as_a"
    )
    person_b: Mapped["Person"] = relationship(  # type: ignore[name-defined]
        "Person", foreign_keys=[person_b_id], back_populates="relationships_as_b"
    )
