from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from app.models.person import GenderEnum


class PersonBase(BaseModel):
    first_name: str
    last_name: str
    birth_name: Optional[str] = None
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = None
    place_of_birth: Optional[str] = None
    date_of_death: Optional[str] = None
    place_of_death: Optional[str] = None
    is_living: bool = True
    nationality: Optional[str] = None
    origin: Optional[str] = None
    occupations: Optional[list] = None
    sources: Optional[list] = None
    biography: Optional[str] = None


class PersonCreate(PersonBase):
    pass


class PersonUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    birth_name: Optional[str] = None
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = None
    place_of_birth: Optional[str] = None
    date_of_death: Optional[str] = None
    place_of_death: Optional[str] = None
    is_living: Optional[bool] = None
    nationality: Optional[str] = None
    origin: Optional[str] = None
    occupations: Optional[list] = None
    sources: Optional[list] = None
    biography: Optional[str] = None


class PersonResponse(PersonBase):
    id: UUID
    avatar_media_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
