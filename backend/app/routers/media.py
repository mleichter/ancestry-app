import io
import os
import uuid
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.media import Media, MediaType
from app.models.person import Person
from app.config import get_settings

router = APIRouter(tags=["media"])

# Extension derived from MIME type only — never from user-supplied filename
EXT_BY_MIME: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


def _safe_media_path(base: str, rel: str) -> str:
    """Return abs_path and raise if it escapes the media storage root."""
    abs_path = os.path.realpath(os.path.join(base, rel))
    base_real = os.path.realpath(base) + os.sep
    if not abs_path.startswith(base_real):
        raise HTTPException(status_code=400, detail="Invalid file path")
    return abs_path


@router.post("/persons/{person_id}/media/avatar", status_code=201, summary="Upload avatar", tags=["media"])
async def upload_avatar(
    person_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload an image and set it as the person's avatar. Accepted formats: JPEG, PNG, WebP, GIF. Max 10 MB."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    settings = get_settings()
    ext = EXT_BY_MIME.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF allowed")

    content = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB")

    media_id = uuid.uuid4()
    rel_path = f"{person_id}/{media_id}.{ext}"
    abs_path = _safe_media_path(settings.media_storage_path, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    with open(abs_path, "wb") as f:
        f.write(content)

    media = Media(
        id=media_id,
        person_id=person_id,
        file_name=f"{media_id}.{ext}",
        file_path=rel_path,
        media_type=MediaType.photo,
        mime_type=file.content_type,
    )
    db.add(media)

    person.avatar_media_id = media_id
    await db.commit()
    await db.refresh(media)
    return {"id": str(media.id), "person_id": str(person_id)}


THUMB_SIZE = (300, 300)


def _thumb_path(original_abs: str) -> str:
    base, _ = os.path.splitext(original_abs)
    return base + "_thumb.jpg"


def _generate_thumb(original_abs: str, thumb_abs: str) -> None:
    from PIL import Image
    with Image.open(original_abs) as img:
        img = img.convert("RGB")
        img.thumbnail(THUMB_SIZE, Image.LANCZOS)
        img.save(thumb_abs, "JPEG", quality=85, optimize=True)


@router.get("/media/{media_id}/file", summary="Serve a media file", tags=["media"])
async def get_media_file(
    media_id: UUID,
    thumb: bool = Query(False, description="Return a 300×300 JPEG thumbnail instead of the original"),
    db: AsyncSession = Depends(get_db),
):
    """Stream the raw file for a media record. Pass `?thumb=true` to get a cached 300×300 thumbnail."""
    media = await db.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    settings = get_settings()
    abs_path = _safe_media_path(settings.media_storage_path, media.file_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    if thumb and media.mime_type and media.mime_type.startswith("image/"):
        thumb_abs = _thumb_path(abs_path)
        if not os.path.exists(thumb_abs):
            try:
                _generate_thumb(abs_path, thumb_abs)
            except Exception:
                # Fall back to full image if thumbnail generation fails
                return FileResponse(abs_path, media_type=media.mime_type)
        return FileResponse(thumb_abs, media_type="image/jpeg")

    return FileResponse(abs_path, media_type=media.mime_type)


@router.get("/persons/{person_id}/media", summary="List person media", tags=["media"])
async def list_person_media(person_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return all media records (photos) belonging to a person, newest first."""
    result = await db.execute(
        select(Media).where(Media.person_id == person_id).order_by(Media.uploaded_at.desc())
    )
    items = result.scalars().all()
    return [
        {
            "id": str(m.id),
            "person_id": str(m.person_id),
            "file_name": m.file_name,
            "media_type": m.media_type.value,
            "mime_type": m.mime_type,
            "uploaded_at": m.uploaded_at.isoformat() if m.uploaded_at else None,
        }
        for m in items
    ]


@router.post("/persons/{person_id}/media", status_code=201, summary="Upload a photo", tags=["media"])
async def upload_photo(
    person_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload a photo to a person's gallery. Does not change the avatar. Accepted: JPEG, PNG, WebP, GIF."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    settings = get_settings()
    ext = EXT_BY_MIME.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, GIF allowed")

    content = await file.read()
    if len(content) > settings.max_upload_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_size_mb} MB")

    media_id = uuid.uuid4()
    rel_path = f"{person_id}/{media_id}.{ext}"
    abs_path = _safe_media_path(settings.media_storage_path, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)

    with open(abs_path, "wb") as fh:
        fh.write(content)

    media = Media(
        id=media_id,
        person_id=person_id,
        file_name=f"{media_id}.{ext}",
        file_path=rel_path,
        media_type=MediaType.photo,
        mime_type=file.content_type,
    )
    db.add(media)
    await db.commit()
    await db.refresh(media)
    return {"id": str(media.id), "person_id": str(person_id)}


@router.delete("/media/{media_id}", status_code=204, summary="Delete a media file", tags=["media"])
async def delete_media(media_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete a media record and its file from disk. Clears the person's avatar if it was the avatar."""
    media = await db.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    person = await db.get(Person, media.person_id)
    if person and person.avatar_media_id == media_id:
        person.avatar_media_id = None

    settings = get_settings()
    try:
        abs_path = _safe_media_path(settings.media_storage_path, media.file_path)
        if os.path.exists(abs_path):
            os.remove(abs_path)
    except Exception:
        pass

    await db.delete(media)
    await db.commit()


@router.patch("/persons/{person_id}/avatar/{media_id}", summary="Set avatar", tags=["media"])
async def set_avatar(person_id: UUID, media_id: UUID, db: AsyncSession = Depends(get_db)):
    """Promote an existing gallery photo to be the person's avatar."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    media = await db.get(Media, media_id)
    if not media or media.person_id != person_id:
        raise HTTPException(status_code=404, detail="Media not found for this person")
    person.avatar_media_id = media_id
    await db.commit()
    return {"id": str(media_id)}
