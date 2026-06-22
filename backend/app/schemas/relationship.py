from uuid import UUID
from datetime import datetime
from pydantic import BaseModel
from typing import Optional
from app.models.relationship import RelationshipType, EndReason


class RelationshipBase(BaseModel):
    person_a_id: UUID
    person_b_id: UUID
    type: RelationshipType
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    end_reason: Optional[EndReason] = None
    notes: Optional[str] = None


class RelationshipCreate(RelationshipBase):
    pass


class RelationshipUpdate(BaseModel):
    type: Optional[RelationshipType] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    end_reason: Optional[EndReason] = None
    notes: Optional[str] = None


class RelationshipResponse(RelationshipBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
