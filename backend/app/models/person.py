import enum
from uuid import UUID, uuid4
from sqlalchemy import String, Text, Boolean, JSON, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base, TimestampMixin


class GenderEnum(str, enum.Enum):
    male = "male"
    female = "female"
    other = "other"
    unknown = "unknown"


class Person(Base, TimestampMixin):
    __tablename__ = "persons"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    birth_name: Mapped[str | None] = mapped_column(String(100))
    gender: Mapped[GenderEnum | None] = mapped_column(SAEnum(GenderEnum))
    date_of_birth: Mapped[str | None] = mapped_column(String(10))
    place_of_birth: Mapped[str | None] = mapped_column(String(200))
    date_of_death: Mapped[str | None] = mapped_column(String(10))
    place_of_death: Mapped[str | None] = mapped_column(String(200))
    is_living: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    nationality: Mapped[str | None] = mapped_column(String(100))
    origin: Mapped[str | None] = mapped_column(String(200))
    occupations: Mapped[list | None] = mapped_column(JSON)
    biography: Mapped[str | None] = mapped_column(Text)
    avatar_media_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("media.id", use_alter=True, name="fk_persons_avatar_media_id"),
        nullable=True,
    )

    media: Mapped[list["Media"]] = relationship(  # type: ignore[name-defined]
        "Media", foreign_keys="[Media.person_id]", back_populates="person"
    )
    relationships_as_a: Mapped[list["Relationship"]] = relationship(  # type: ignore[name-defined]
        "Relationship", foreign_keys="[Relationship.person_a_id]", back_populates="person_a"
    )
    relationships_as_b: Mapped[list["Relationship"]] = relationship(  # type: ignore[name-defined]
        "Relationship", foreign_keys="[Relationship.person_b_id]", back_populates="person_b"
    )
