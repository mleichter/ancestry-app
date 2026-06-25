from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.person import Person
from app.schemas.person import PersonCreate, PersonUpdate, PersonResponse

router = APIRouter(prefix="/persons", tags=["persons"])


@router.get("", response_model=list[PersonResponse], summary="List all persons")
async def list_persons(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    """Return persons in the family tree. Max 1000 per page; use skip for pagination."""
    result = await db.execute(select(Person).offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=PersonResponse, status_code=201, summary="Create a person")
async def create_person(data: PersonCreate, db: AsyncSession = Depends(get_db)):
    """Create a new person record. Only `first_name` and `last_name` are required."""
    person = Person(**data.model_dump())
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


@router.get("/{person_id}", response_model=PersonResponse, summary="Get a person")
async def get_person(person_id: UUID, db: AsyncSession = Depends(get_db)):
    """Fetch a single person by UUID. Returns 404 if not found."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@router.patch("/{person_id}", response_model=PersonResponse, summary="Update a person")
async def update_person(
    person_id: UUID, data: PersonUpdate, db: AsyncSession = Depends(get_db)
):
    """Partially update a person. Only fields present in the request body are changed."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    await db.commit()
    await db.refresh(person)
    return person


@router.delete("/{person_id}", status_code=204, summary="Delete a person")
async def delete_person(person_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a person and all their relationships. Media files are not automatically removed."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    await db.delete(person)
    await db.commit()
