from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models.person import Person
from app.schemas.person import PersonCreate, PersonUpdate, PersonResponse

router = APIRouter(prefix="/persons", tags=["persons"])


@router.get("", response_model=list[PersonResponse])
async def list_persons(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Person).offset(skip).limit(limit))
    return result.scalars().all()


@router.post("", response_model=PersonResponse, status_code=201)
async def create_person(data: PersonCreate, db: AsyncSession = Depends(get_db)):
    person = Person(**data.model_dump())
    db.add(person)
    await db.commit()
    await db.refresh(person)
    return person


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(person_id: UUID, db: AsyncSession = Depends(get_db)):
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@router.patch("/{person_id}", response_model=PersonResponse)
async def update_person(
    person_id: UUID, data: PersonUpdate, db: AsyncSession = Depends(get_db)
):
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(person, field, value)
    await db.commit()
    await db.refresh(person)
    return person


@router.delete("/{person_id}", status_code=204)
async def delete_person(person_id: UUID, db: AsyncSession = Depends(get_db)):
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    await db.delete(person)
    await db.commit()
