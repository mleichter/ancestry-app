import os
import uuid
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.media import Media, MediaType
from app.models.person import Person
from app.config import get_settings

router = APIRouter(tags=["media"])

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.post("/persons/{person_id}/media/avatar", status_code=201)
async def upload_avatar(
    person_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    settings = get_settings()
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF allowed")

    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB")

    ext = (file.filename or "photo").rsplit(".", 1)[-1].lower()
    media_id = uuid.uuid4()
    rel_path = f"{person_id}/{media_id}.{ext}"
    abs_path = os.path.join(settings.media_storage_path, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    with open(abs_path, "wb") as f:
        f.write(content)

    media = Media(
        id=media_id,
        person_id=person_id,
        file_name=file.filename or f"{media_id}.{ext}",
        file_path=rel_path,
        media_type=MediaType.photo,
        mime_type=file.content_type,
    )
    db.add(media)

    person.avatar_media_id = media_id
    await db.commit()
    await db.refresh(media)
    return {"id": str(media.id), "person_id": str(person_id)}


@router.get("/media/{media_id}/file")
async def get_media_file(media_id: UUID, db: AsyncSession = Depends(get_db)):
    media = await db.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    settings = get_settings()
    abs_path = os.path.join(settings.media_storage_path, media.file_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(abs_path, media_type=media.mime_type)
