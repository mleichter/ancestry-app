from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.relationship import Relationship
from app.schemas.relationship import RelationshipCreate, RelationshipUpdate, RelationshipResponse

router = APIRouter(prefix="/relationships", tags=["relationships"])


@router.get("", response_model=list[RelationshipResponse])
async def list_relationships(
    person_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Relationship)
    if person_id:
        stmt = stmt.where(
            (Relationship.person_a_id == person_id) | (Relationship.person_b_id == person_id)
        )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=RelationshipResponse, status_code=201)
async def create_relationship(data: RelationshipCreate, db: AsyncSession = Depends(get_db)):
    rel = Relationship(**data.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    return rel


@router.get("/{rel_id}", response_model=RelationshipResponse)
async def get_relationship(rel_id: UUID, db: AsyncSession = Depends(get_db)):
    rel = await db.get(Relationship, rel_id)
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    return rel


@router.patch("/{rel_id}", response_model=RelationshipResponse)
async def update_relationship(
    rel_id: UUID, data: RelationshipUpdate, db: AsyncSession = Depends(get_db)
):
    rel = await db.get(Relationship, rel_id)
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(rel, field, value)
    await db.commit()
    await db.refresh(rel)
    return rel


@router.delete("/{rel_id}", status_code=204)
async def delete_relationship(rel_id: UUID, db: AsyncSession = Depends(get_db)):
    rel = await db.get(Relationship, rel_id)
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    await db.delete(rel)
    await db.commit()
