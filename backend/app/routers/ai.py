from fastapi import APIRouter, HTTPException, UploadFile, File

from app.config import get_settings
from app.services.ai_extractor import extract_from_document, pdf_to_image_bytes

router = APIRouter(prefix="/ai", tags=["ai"])

_ACCEPTED_MIME = {"image/jpeg", "image/png", "image/webp", "application/pdf"}


@router.get("/status", summary="AI availability check")
async def ai_status():
    """Returns whether an OpenAI API key is configured on the server."""
    return {"available": bool(get_settings().openai_api_key)}


@router.post("/extract-document", summary="Extract person data from a document image")
async def extract_document_endpoint(file: UploadFile = File(...)):
    """
    Upload a historical document image. Returns extracted person fields with
    confidence scores and a base64-encoded cropped portrait (if found).
    Does not write to the database.
    """
    if not get_settings().openai_api_key:
        raise HTTPException(status_code=503, detail="AI not configured")
    if (file.content_type or "") not in _ACCEPTED_MIME:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP allowed")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    mime = file.content_type
    if mime == "application/pdf":
        try:
            image_bytes = pdf_to_image_bytes(image_bytes)
        except Exception:
            raise HTTPException(status_code=422, detail="Could not render PDF — is it a valid, non-encrypted PDF?")
        mime = "image/jpeg"

    result = await extract_from_document(image_bytes, mime)

    return {
        "fields": {
            k: {"value": v.value, "confidence": v.confidence}
            for k, v in result.fields.items()
        },
        "portrait_b64": result.portrait_b64,
        "document_type": result.document_type,
    }
