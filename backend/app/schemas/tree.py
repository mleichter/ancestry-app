from uuid import UUID
from pydantic import BaseModel
from typing import Optional
from app.models.person import GenderEnum


class TreeNode(BaseModel):
    id: str
    label: str
    gender: Optional[GenderEnum] = None
    date_of_birth: Optional[str] = None
    date_of_death: Optional[str] = None
    is_living: bool = True
    avatar_media_id: Optional[UUID] = None


class TreeEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    label: Optional[str] = None


class TreeResponse(BaseModel):
    nodes: list[TreeNode]
    edges: list[TreeEdge]
