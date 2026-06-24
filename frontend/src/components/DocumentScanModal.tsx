import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettings } from '../hooks/useSettings'
import { useToast } from '../hooks/useToast'
import { aiApi, mediaApi, personsApi } from '../api/client'
import type { ExtractionResult, Person, PersonCreate, PendingMedia } from '../types'

// ── helpers ────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  first_name: 'Vorname', last_name: 'Nachname', birth_name: 'Geburtsname',
  gender: 'Geschlecht', date_of_birth: 'Geburtsdatum', place_of_birth: 'Geburtsort',
  date_of_death: 'Sterbedatum', place_of_death: 'Sterbeort',
  nationality: 'Nationalität', origin: 'Herkunft', occupations: 'Berufe', biography: 'Biografie',
}

const GENDER_LABELS: Record<string, string> = {
  male: 'Männlich', female: 'Weiblich', other: 'Divers', unknown: 'Unbekannt',
}

function displayValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '–'
  if (key === 'gender' && typeof value === 'string') return GENDER_LABELS[value] ?? value
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function ConfidenceIndicator({ confidence }: { confidence: string }) {
  const filled = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1
  const colors: Record<string, string> = {
    high: 'text-green-500', medium: 'text-yellow-500', low: 'text-orange-400',
  }
  return (
    <span className={`text-xs font-mono ${colors[confidence] ?? ''}`}>
      {'●'.repeat(filled)}{'○'.repeat(3 - filled)}
    </span>
  )
}

function base64ToBlob(b64: string, mimeType: string): Blob {
  const bytes = atob(b64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mimeType })
}

// ── exported pure function (tested in Vitest) ──────────────────────────────

export function initialCheckedFields(
  result: ExtractionResult,
  currentPerson: Partial<Person>,
): Set<string> {
  const checked = new Set<string>()
  for (const [key, field] of Object.entries(result.fields)) {
    if (!field || field.confidence === 'none' || field.value === null) continue
    if (field.confidence === 'low') continue
    const currentVal = (currentPerson as Record<string, unknown>)[key]
    const toStr = (v: unknown) => (Array.isArray(v) ? JSON.stringify(v) : String(v ?? ''))
    if (toStr(field.value) === toStr(currentVal)) continue
    checked.add(key)
  }
  return checked
}

// ── component ──────────────────────────────────────────────────────────────

interface DocumentScanModalProps {
  personId: string
  currentPerson?: Partial<Person>
  mode: 'patch' | 'prefill'
  onClose: () => void
  onPrefill?: (fields: Partial<PersonCreate>, pendingMedia: PendingMedia[]) => void
}

type Step = 'upload' | 'review'
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export function DocumentScanModal({
  personId,
  currentPerson = {},
  mode,
  onClose,
  onPrefill,
}: DocumentScanModalProps) {
  const { settings } = useSettings()
  const { addToast } = useToast()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [useAi, setUseAi] = useState(settings.ai_enabled)
  const [file, setFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedFields, setCheckedFields] = useState<Set<string>>(new Set())
  const [savePortrait, setSavePortrait] = useState(true)
  const [setAsAvatar, setSetAsAvatar] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = (f: File) => {
    if (!ACCEPTED.includes(f.type)) { setError('Nur JPEG, PNG, WebP oder PDF erlaubt.'); return }
    setFile(f)
    setFilePreviewUrl(URL.createObjectURL(f))
    setError(null)
  }

  const handleAnalyze = async () => {
    if (!file) return
    if (!useAi) { await handleConfirmNoAi(); return }
    setIsAnalyzing(true); setError(null)
    try {
      const extracted = await aiApi.extractDocument(file)
      setResult(extracted)
      setCheckedFields(initialCheckedFields(extracted, currentPerson))
      setSavePortrait(Boolean(extracted.portrait_b64))
      setStep('review')
    } catch {
      setError('Analyse fehlgeschlagen. Bitte erneut versuchen.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleConfirmNoAi = async () => {
    if (!file) return
    setIsApplying(true)
    try {
      if (mode === 'patch') {
        await mediaApi.uploadDocument(personId, file)
        qc.invalidateQueries({ queryKey: ['media', personId] })
        addToast('Dokument gespeichert.', 'success')
      } else {
        onPrefill?.({}, [{ file, mediaType: 'document' }])
      }
      onClose()
    } catch { setError('Dokument konnte nicht gespeichert werden.')
    } finally { setIsApplying(false) }
  }

  const handleConfirm = async () => {
    if (!result || !file) return
    setIsApplying(true); setError(null)
    try {
      if (mode === 'patch') {
        const patch: Record<string, unknown> = {}
        for (const key of checkedFields) {
          const f = result.fields[key]; if (f) patch[key] = f.value
        }
        if (Object.keys(patch).length > 0)
          await personsApi.update(personId, patch as Partial<PersonCreate>)
        await mediaApi.uploadDocument(personId, file, result.document_type ?? undefined)
        if (savePortrait && result.portrait_b64) {
          const blob = base64ToBlob(result.portrait_b64, 'image/jpeg')
          const pf = new File([blob], 'portrait.jpg', { type: 'image/jpeg' })
          const uploaded = await mediaApi.uploadPhoto(personId, pf)
          if (setAsAvatar) await mediaApi.setAvatar(personId, uploaded.id)
        }
        qc.invalidateQueries({ queryKey: ['persons', personId] })
        qc.invalidateQueries({ queryKey: ['media', personId] })
        qc.invalidateQueries({ queryKey: ['tree'] })
        const parts: string[] = []
        if (checkedFields.size > 0) parts.push(`${checkedFields.size} Felder übernommen`)
        if (savePortrait && result.portrait_b64) parts.push('Foto gespeichert')
        addToast(parts.join(' · ') || 'Dokument gespeichert.', 'success')
      } else {
        const fields: Partial<PersonCreate> = {}
        for (const key of checkedFields) {
          const f = result.fields[key]
          if (f) (fields as Record<string, unknown>)[key] = f.value
        }
        const pending: PendingMedia[] = [
          { file, mediaType: 'document', title: result.document_type ?? undefined },
        ]
        if (savePortrait && result.portrait_b64) {
          const blob = base64ToBlob(result.portrait_b64, 'image/jpeg')
          const pf = new File([blob], 'portrait.jpg', { type: 'image/jpeg' })
          pending.push({ file: pf, mediaType: 'photo', setAsAvatar })
        }
        onPrefill?.(fields, pending)
      }
      onClose()
    } catch { setError('Fehler beim Speichern. Bitte erneut versuchen.')
    } finally { setIsApplying(false) }
  }

  const toggleField = (key: string) =>
    setCheckedFields(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {step === 'upload' ? 'Dokument scannen' : 'Ergebnisse prüfen'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">✕</button>
        </div>

        <div className="p-5">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400'
                }`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div className="space-y-2">
                    {file.type === 'application/pdf'
                      ? <div className="mx-auto w-16 h-20 flex items-center justify-center text-5xl">📄</div>
                      : filePreviewUrl && <img src={filePreviewUrl} alt="Vorschau" className="mx-auto max-h-40 object-contain rounded" />
                    }
                    <p className="text-sm text-gray-600 dark:text-gray-300">{file.name}</p>
                    <p className="text-xs text-gray-400">Klicken zum Ändern</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-4xl text-gray-300 dark:text-gray-600">📄</div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Datei hierher ziehen oder klicken</p>
                    <p className="text-xs text-gray-400">JPEG, PNG, WebP, PDF</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />

              {/* AI toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative shrink-0">
                  <input type="checkbox" className="sr-only" checked={useAi} onChange={e => setUseAi(e.target.checked)} />
                  <div className={`w-10 h-6 rounded-full transition-colors ${useAi ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${useAi ? 'translate-x-4' : ''}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">KI-Analyse verwenden</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Felder automatisch auslesen</p>
                </div>
              </label>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* Step 2: Review */}
          {step === 'review' && result && (
            <div className="space-y-4">
              <div className="flex gap-4 flex-wrap">
                {file?.type === 'application/pdf'
                  ? <div className="w-32 h-40 flex items-center justify-center text-6xl rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0">📄</div>
                  : filePreviewUrl && <img src={filePreviewUrl} alt="Dokument" className="w-32 h-40 object-cover rounded border border-gray-200 dark:border-gray-700 shrink-0" />
                }
                {result.portrait_b64 && (
                  <div className="space-y-1.5">
                    <img src={`data:image/jpeg;base64,${result.portrait_b64}`} alt="Porträt"
                      className="w-24 h-28 object-cover rounded border border-gray-200 dark:border-gray-700" />
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={savePortrait} onChange={e => setSavePortrait(e.target.checked)} className="w-3.5 h-3.5" />
                      Foto speichern
                    </label>
                    {savePortrait && (
                      <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                        <input type="checkbox" checked={setAsAvatar} onChange={e => setSetAsAvatar(e.target.checked)} className="w-3.5 h-3.5" />
                        Als Avatar setzen
                      </label>
                    )}
                  </div>
                )}
                {result.document_type && (
                  <p className="text-xs text-gray-400 self-end">Typ: {result.document_type}</p>
                )}
              </div>

              {Object.entries(result.fields).filter(([, f]) => f?.confidence !== 'none').length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Keine Felder erkannt.</p>
              ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        <th className="px-3 py-2 w-8"></th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Feld</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Aktuell</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Erkannt</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-500"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.fields)
                        .filter(([, f]) => f?.confidence !== 'none')
                        .map(([key, field]) => (
                          <tr key={key} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={checkedFields.has(key)}
                                onChange={() => toggleField(key)} className="w-3.5 h-3.5" />
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 text-xs">
                              {FIELD_LABELS[key] ?? key}
                            </td>
                            <td className="px-3 py-2 text-gray-400 dark:text-gray-500 text-xs max-w-[100px] truncate">
                              {displayValue(key, (currentPerson as Record<string, unknown>)[key])}
                            </td>
                            <td className="px-3 py-2 text-gray-800 dark:text-gray-100 text-xs max-w-[100px] truncate">
                              {displayValue(key, field?.value)}
                            </td>
                            <td className="px-3 py-2">
                              {field && <ConfidenceIndicator confidence={field.confidence} />}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Abbrechen
          </button>
          {step === 'upload' ? (
            <button
              onClick={handleAnalyze}
              disabled={!file || isAnalyzing}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
            >
              {isAnalyzing
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analysiere…</>
                : useAi ? 'Analysieren →' : 'Speichern'}
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={isApplying}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
            >
              {isApplying ? 'Übernehme…' : 'Übernehmen →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
