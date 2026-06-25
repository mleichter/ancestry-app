import re
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from app.models.person import GenderEnum

_DATE_RE = re.compile(r'^\d{4}(-\d{2}(-\d{2})?)?$')


def _validate_partial_date(v: Optional[str]) -> Optional[str]:
    if v is not None and not _DATE_RE.match(v):
        raise ValueError('Date must be YYYY, YYYY-MM, or YYYY-MM-DD')
    return v


class PersonBase(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    birth_name: Optional[str] = Field(None, max_length=100)
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = Field(None, max_length=10)
    place_of_birth: Optional[str] = Field(None, max_length=200)
    date_of_death: Optional[str] = Field(None, max_length=10)
    place_of_death: Optional[str] = Field(None, max_length=200)
    is_living: bool = True
    nationality: Optional[str] = Field(None, max_length=100)
    origin: Optional[str] = Field(None, max_length=200)
    occupations: Optional[list] = None
    sources: Optional[list] = None
    biography: Optional[str] = Field(None, max_length=10000)

    @field_validator('date_of_birth', 'date_of_death', mode='before')
    @classmethod
    def validate_date(cls, v: Optional[str]) -> Optional[str]:
        return _validate_partial_date(v)


class PersonCreate(PersonBase):
    pass


class PersonUpdate(BaseModel):
    first_name: Optional[str] = Field(None, min_length=1, max_length=100)
    last_name: Optional[str] = Field(None, min_length=1, max_length=100)
    birth_name: Optional[str] = Field(None, max_length=100)
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = Field(None, max_length=10)
    place_of_birth: Optional[str] = Field(None, max_length=200)
    date_of_death: Optional[str] = Field(None, max_length=10)
    place_of_death: Optional[str] = Field(None, max_length=200)
    is_living: Optional[bool] = None
    nationality: Optional[str] = Field(None, max_length=100)
    origin: Optional[str] = Field(None, max_length=200)
    occupations: Optional[list] = None
    sources: Optional[list] = None
    biography: Optional[str] = Field(None, max_length=10000)

    @field_validator('date_of_birth', 'date_of_death', mode='before')
    @classmethod
    def validate_date(cls, v: Optional[str]) -> Optional[str]:
        return _validate_partial_date(v)


class PersonResponse(PersonBase):
    id: UUID
    avatar_media_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
