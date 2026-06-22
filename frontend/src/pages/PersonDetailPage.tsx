import { useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { personsApi, relationshipsApi, mediaApi } from '../api/client'
import type { RelationshipCreate, RelationshipType, MediaItem } from '../types'

function MapsLink({ place }: { place: string }) {
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      className="ml-2 text-xs text-indigo-500 dark:text-indigo-400 hover:underline shrink-0"
      title="Auf Google Maps anzeigen">
      📍 Karte
    </a>
  )
}

function InfoRow({ label, value, withMap }: { label: string; value?: string | null; withMap?: boolean }) {
  if (!value) return null
  return (
    <div className="flex gap-4 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-gray-500 dark:text-gray-400 w-40 shrink-0 text-sm">{label}</span>
      <span className="text-gray-800 dark:text-gray-200 text-sm flex items-center gap-1 flex-wrap">
        {value}
        {withMap && <MapsLink place={value} />}
      </span>
    </div>
  )
}

type RelFormData = {
  person_b_id: string
  type: RelationshipType
  start_date: string
  end_date: string
  notes: string
}

function PhotoGallery({ personId }: { personId: string }) {
  const qc = useQueryClient()
  const photoRef = useRef<HTMLInputElement>(null)
  const [lightbox, setLightbox] = useState<MediaItem | null>(null)

  const { data: media = [] } = useQuery({
    queryKey: ['media', personId],
    queryFn: () => mediaApi.listPersonMedia(personId),
  })

  const { data: person } = useQuery({
    queryKey: ['persons', personId],
    queryFn: () => personsApi.get(personId),
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => mediaApi.uploadPhoto(personId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media', personId] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (mediaId: string) => mediaApi.deleteMedia(mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', personId] })
      qc.invalidateQueries({ queryKey: ['persons', personId] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      setLightbox(null)
    },
  })

  const setAvatarMutation = useMutation({
    mutationFn: (mediaId: string) => mediaApi.setAvatar(personId, mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons', personId] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
  })

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300">Fotos ({media.length})</h2>
        <button
          onClick={() => photoRef.current?.click()}
          disabled={uploadMutation.isPending}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
        >
          {uploadMutation.isPending ? 'Hochladen…' : '+ Foto hinzufügen'}
        </button>
        <input ref={photoRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadMutation.mutate(f); e.target.value = '' }} />
      </div>

      {media.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">Noch keine Fotos vorhanden.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {media.map(m => (
            <div key={m.id} className="relative group aspect-square cursor-pointer"
              onClick={() => setLightbox(m)}>
              <img
                src={mediaApi.fileUrl(m.id)}
                alt={m.file_name}
                className="w-full h-full object-cover rounded-lg border border-gray-200 dark:border-gray-700"
              />
              {person?.avatar_media_id === m.id && (
                <span className="absolute top-1 left-1 bg-indigo-600 text-white text-[9px] px-1 py-0.5 rounded font-medium">
                  Avatar
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-2xl max-w-2xl w-full"
            onClick={e => e.stopPropagation()}>
            <img
              src={mediaApi.fileUrl(lightbox.id)}
              alt={lightbox.file_name}
              className="w-full object-contain max-h-[70vh]"
            />
            <div className="p-4 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{lightbox.file_name}</span>
              <div className="flex gap-2 shrink-0">
                {person?.avatar_media_id !== lightbox.id && (
                  <button
                    onClick={() => setAvatarMutation.mutate(lightbox.id)}
                    disabled={setAvatarMutation.isPending}
                    className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50"
                  >
                    Als Avatar
                  </button>
                )}
                <button
                  onClick={() => { if (confirm('Foto löschen?')) deleteMutation.mutate(lightbox.id) }}
                  className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50"
                >
                  Löschen
                </button>
                <button onClick={() => setLightbox(null)}
                  className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg">
                  Schließen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showRelForm, setShowRelForm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: person, isLoading } = useQuery({
    queryKey: ['persons', id],
    queryFn: () => personsApi.get(id!),
  })
  const { data: allPersons = [] } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })
  const { data: rels = [] } = useQuery({
    queryKey: ['relationships', id],
    queryFn: () => relationshipsApi.list(id),
  })

  const invalidateRels = () => {
    qc.invalidateQueries({ queryKey: ['relationships', id] })
    qc.invalidateQueries({ queryKey: ['tree'] })
  }

  const deletePersonMutation = useMutation({
    mutationFn: () => personsApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      navigate('/persons')
    },
  })
  const addRelMutation = useMutation({
    mutationFn: (data: RelationshipCreate) => relationshipsApi.create(data),
    onSuccess: () => { invalidateRels(); setShowRelForm(false) },
  })
  const deleteRelMutation = useMutation({
    mutationFn: (relId: string) => relationshipsApi.delete(relId),
    onSuccess: invalidateRels,
  })
  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => mediaApi.uploadAvatar(id!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons', id] })
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
  })

  const { register, handleSubmit, reset, watch } = useForm<RelFormData>({
    defaultValues: { person_b_id: '', type: '' as RelationshipType, start_date: '', end_date: '', notes: '' },
  })
  const relType = watch('type')

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Lade…</div>
  if (!person) return <div className="text-center py-12 text-red-500">Person nicht gefunden</div>

  const otherPersons = allPersons.filter(p => p.id !== id)
  const personById = Object.fromEntries(allPersons.map(p => [p.id, p]))

  const onAddRel = (data: RelFormData) => {
    const payload: RelationshipCreate = {
      person_a_id: id!,
      person_b_id: data.person_b_id,
      type: data.type,
      ...(data.start_date && { start_date: data.start_date }),
      ...(data.end_date   && { end_date:   data.end_date   }),
      ...(data.notes      && { notes:      data.notes      }),
    }
    addRelMutation.mutate(payload)
  }

  const inp = 'border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm w-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500'

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="relative group">
            {person.avatar_media_id ? (
              <img src={mediaApi.fileUrl(person.avatar_media_id)}
                alt={`${person.first_name} ${person.last_name}`}
                className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600 shadow" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 text-xl font-medium">
                {person.first_name[0]}{person.last_name[0]}
              </div>
            )}
            <button onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs"
              title="Foto hochladen">
              {uploadAvatarMutation.isPending ? '…' : '📷'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadAvatarMutation.mutate(f) }} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">{person.first_name} {person.last_name}</h1>
            {person.birth_name && <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">geb. {person.birth_name}</p>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link to={`/persons/${id}/edit`}
            className="px-4 py-2 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-sm">
            Bearbeiten
          </Link>
          <button onClick={() => { if (confirm('Person löschen?')) deletePersonMutation.mutate() }}
            className="px-4 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-sm">
            Löschen
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Personendaten</h2>
        <InfoRow label="Geschlecht" value={person.gender} />
        <InfoRow label="Geburtsdatum" value={person.date_of_birth} />
        <InfoRow label="Geburtsort" value={person.place_of_birth} withMap />
        <InfoRow label="Sterbedatum" value={person.date_of_death} />
        <InfoRow label="Sterbeort" value={person.place_of_death} withMap />
        <InfoRow label="Nationalität" value={person.nationality} />
        <InfoRow label="Herkunft" value={person.origin} />
        {person.biography && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Biografie</p>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{person.biography}</p>
          </div>
        )}
      </div>

      {/* Photo Gallery */}
      <PhotoGallery personId={id!} />

      {/* Relationships */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300">Beziehungen</h2>
          <button onClick={() => setShowRelForm(v => !v)}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            + Beziehung hinzufügen
          </button>
        </div>

        {showRelForm && (
          <form onSubmit={handleSubmit(onAddRel)}
            className="bg-indigo-50 dark:bg-indigo-950/40 rounded-lg p-4 mb-4 space-y-3 border border-indigo-100 dark:border-indigo-900">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Person *</label>
                <select {...register('person_b_id', { required: true })} className={inp}>
                  <option value="">– wählen –</option>
                  {otherPersons.map(p => (
                    <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Art *</label>
                <select {...register('type', { required: true })} className={inp}>
                  <option value="">– wählen –</option>
                  <option value="parent_child">Diese Person ist Elternteil</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
            </div>
            {relType === 'partner' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Beginn (z.B. Hochzeit)</label>
                    <input {...register('start_date')} placeholder="JJJJ-MM-TT" className={inp} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Ende</label>
                    <input {...register('end_date')} placeholder="JJJJ-MM-TT" className={inp} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notizen</label>
                  <input {...register('notes')} placeholder="z.B. verheiratet in München" className={inp} />
                </div>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={addRelMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
                Hinzufügen
              </button>
              <button type="button" onClick={() => { setShowRelForm(false); reset() }}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-2">
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {rels.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Keine Beziehungen vorhanden.</p>
        ) : (
          <div className="space-y-1">
            {rels.map(rel => {
              const otherId = rel.person_a_id === id ? rel.person_b_id : rel.person_a_id
              const other = personById[otherId]
              const isParent = rel.type === 'parent_child'
              const isA = rel.person_a_id === id
              const dateRange = [rel.start_date, rel.end_date].filter(Boolean).join(' – ')
              return (
                <div key={rel.id} className="flex items-start justify-between py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="flex items-start gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-0.5 shrink-0 ${
                      isParent
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300'
                    }`}>
                      {isParent ? (isA ? 'Elternteil von' : 'Kind von') : 'Partner von'}
                    </span>
                    <div>
                      <Link to={`/persons/${otherId}`}
                        className="text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400">
                        {other ? `${other.first_name} ${other.last_name}` : otherId}
                      </Link>
                      {dateRange && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{dateRange}</p>}
                      {rel.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic">{rel.notes}</p>}
                    </div>
                  </div>
                  <button onClick={() => deleteRelMutation.mutate(rel.id)}
                    className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 px-2 mt-0.5 shrink-0">✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
