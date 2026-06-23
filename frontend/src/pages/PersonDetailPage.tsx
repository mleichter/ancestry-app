import { useRef, useState, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { personsApi, relationshipsApi, mediaApi } from '../api/client'
import { useToast, apiErrMsg } from '../hooks/useToast'
import type { RelationshipCreate, RelationshipType, MediaItem, Person, Relationship } from '../types'

// ── Relationship path finder ──────────────────────────────────────────────────

type StepLabel = 'Kind' | 'Elternteil' | 'Partner'
interface PathStep { personId: string; via?: StepLabel }

function findRelPath(fromId: string, toId: string, rels: Relationship[]): PathStep[] | null {
  if (fromId === toId) return [{ personId: fromId }]
  const adj = new Map<string, { to: string; label: StepLabel }[]>()
  const ensure = (id: string) => { if (!adj.has(id)) adj.set(id, []) }
  for (const rel of rels) {
    const a = rel.person_a_id, b = rel.person_b_id
    ensure(a); ensure(b)
    if (rel.type === 'parent_child') {
      adj.get(a)!.push({ to: b, label: 'Kind' })
      adj.get(b)!.push({ to: a, label: 'Elternteil' })
    } else {
      adj.get(a)!.push({ to: b, label: 'Partner' })
      adj.get(b)!.push({ to: a, label: 'Partner' })
    }
  }
  const visited = new Set([fromId])
  const parent = new Map<string, { prev: string; label: StepLabel }>()
  const queue = [fromId]
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === toId) {
      const steps: PathStep[] = []
      let node = toId
      while (node !== fromId) {
        const p = parent.get(node)!
        steps.unshift({ personId: node, via: p.label })
        node = p.prev
      }
      steps.unshift({ personId: fromId })
      return steps
    }
    for (const edge of adj.get(cur) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        parent.set(edge.to, { prev: cur, label: edge.label })
        queue.push(edge.to)
      }
    }
  }
  return null
}

const STEP_COLOR: Record<StepLabel, string> = {
  Kind:      'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  Elternteil:'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  Partner:   'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',
}

function RelPathFinder({ currentId, allPersons, allRels }: {
  currentId: string
  allPersons: Person[]
  allRels: Relationship[]
}) {
  const [targetId, setTargetId] = useState('')
  const others = allPersons.filter(p => p.id !== currentId)
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  const personById = useMemo(
    () => Object.fromEntries(allPersons.map(p => [p.id, p])),
    [allPersons]
  )
  const path = useMemo(
    () => targetId ? findRelPath(currentId, targetId, allRels) : null,
    [currentId, targetId, allRels]
  )

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
      <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Verwandtschaftsweg</h2>
      <select
        value={targetId}
        onChange={e => setTargetId(e.target.value)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 mb-4"
      >
        <option value="">– Person auswählen –</option>
        {others.map(p => (
          <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
        ))}
      </select>

      {targetId && path === null && (
        <p className="text-sm text-gray-400 dark:text-gray-500">Keine Verbindung gefunden.</p>
      )}

      {path && path.length > 1 && (
        <div className="flex items-center flex-wrap gap-1">
          {path.map((step, i) => {
            const p = personById[step.personId]
            const name = p ? `${p.first_name} ${p.last_name}` : step.personId
            return (
              <span key={i} className="flex items-center gap-1">
                {step.via && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STEP_COLOR[step.via]}`}>
                    {step.via}
                  </span>
                )}
                <Link
                  to={`/persons/${step.personId}`}
                  className={`text-sm font-medium ${
                    step.personId === currentId || step.personId === targetId
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-gray-700 dark:text-gray-200 hover:text-indigo-500 dark:hover:text-indigo-300'
                  }`}
                >
                  {name}
                </Link>
                {i < path.length - 1 && <span className="text-gray-300 dark:text-gray-600">→</span>}
              </span>
            )
          })}
        </div>
      )}
      {path && path.length > 1 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {path.length - 1} Schritt{path.length - 1 !== 1 ? 'e' : ''} entfernt
        </p>
      )}
    </div>
  )
}

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
  const { addToast } = useToast()
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
    onError: (err) => addToast(apiErrMsg(err, 'Foto konnte nicht hochgeladen werden.'), 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (mediaId: string) => mediaApi.deleteMedia(mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', personId] })
      qc.invalidateQueries({ queryKey: ['persons', personId] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      setLightbox(null)
    },
    onError: (err) => addToast(apiErrMsg(err, 'Foto konnte nicht gelöscht werden.'), 'error'),
  })

  const setAvatarMutation = useMutation({
    mutationFn: (mediaId: string) => mediaApi.setAvatar(personId, mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons', personId] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (err) => addToast(apiErrMsg(err, 'Avatar konnte nicht gesetzt werden.'), 'error'),
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
                src={mediaApi.fileUrl(m.id, { thumb: true })}
                alt={m.file_name}
                loading="lazy"
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
  const { addToast } = useToast()
  const [showRelForm, setShowRelForm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: person, isLoading } = useQuery({
    queryKey: ['persons', id],
    queryFn: () => personsApi.get(id!),
  })
  const { data: allPersons = [] } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })
  const { data: allRels = [] } = useQuery({
    queryKey: ['relationships'],
    queryFn: () => relationshipsApi.list(),
  })
  // Direct relationships of this person (for add/delete management)
  const rels = allRels.filter(r => r.person_a_id === id || r.person_b_id === id)

  const invalidateRels = () => {
    qc.invalidateQueries({ queryKey: ['relationships'] })
    qc.invalidateQueries({ queryKey: ['tree'] })
  }

  const deletePersonMutation = useMutation({
    mutationFn: () => personsApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      navigate('/persons')
    },
    onError: (err) => addToast(apiErrMsg(err, 'Person konnte nicht gelöscht werden.'), 'error'),
  })
  const addRelMutation = useMutation({
    mutationFn: (data: RelationshipCreate) => relationshipsApi.create(data),
    onSuccess: () => { invalidateRels(); setShowRelForm(false) },
    onError: (err) => addToast(apiErrMsg(err, 'Beziehung konnte nicht hinzugefügt werden.'), 'error'),
  })
  const deleteRelMutation = useMutation({
    mutationFn: (relId: string) => relationshipsApi.delete(relId),
    onSuccess: invalidateRels,
    onError: (err) => addToast(apiErrMsg(err, 'Beziehung konnte nicht gelöscht werden.'), 'error'),
  })
  const uploadAvatarMutation = useMutation({
    mutationFn: (file: File) => mediaApi.uploadAvatar(id!, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons', id] })
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
    onError: (err) => addToast(apiErrMsg(err, 'Avatar konnte nicht hochgeladen werden.'), 'error'),
  })

  const { register, handleSubmit, reset, watch } = useForm<RelFormData>({
    defaultValues: { person_b_id: '', type: '' as RelationshipType, start_date: '', end_date: '', notes: '' },
  })
  const relType = watch('type')

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Lade…</div>
  if (!person) return <div className="text-center py-12 text-red-500">Person nicht gefunden</div>

  const otherPersons = allPersons.filter(p => p.id !== id)
  const personById = Object.fromEntries(allPersons.map(p => [p.id, p]))

  // Computed relatives
  const parentIds = allRels.filter(r => r.type === 'parent_child' && r.person_b_id === id).map(r => r.person_a_id)
  const childIds  = allRels.filter(r => r.type === 'parent_child' && r.person_a_id === id).map(r => r.person_b_id)
  const partnerIds = allRels
    .filter(r => r.type === 'partner' && (r.person_a_id === id || r.person_b_id === id))
    .map(r => r.person_a_id === id ? r.person_b_id : r.person_a_id)
  const siblingIds = [...new Set(
    allRels
      .filter(r => r.type === 'parent_child' && parentIds.includes(r.person_a_id) && r.person_b_id !== id)
      .map(r => r.person_b_id)
  )]

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
              <img src={mediaApi.fileUrl(person.avatar_media_id, { thumb: true })}
                alt={`${person.first_name} ${person.last_name}`}
                loading="lazy"
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
        <InfoRow label="Geschlecht" value={person.gender ? ({ male: 'männlich', female: 'weiblich', other: 'divers', unknown: 'unbekannt' }[person.gender]) : undefined} />
        <InfoRow label="Geburtsdatum" value={person.date_of_birth} />
        <InfoRow label="Geburtsort" value={person.place_of_birth} withMap />
        <InfoRow label="Sterbedatum" value={person.date_of_death} />
        <InfoRow label="Sterbeort" value={person.place_of_death} withMap />
        <InfoRow label="Nationalität" value={person.nationality} />
        <InfoRow label="Herkunft" value={person.origin} />
        {person.occupations && person.occupations.length > 0 && (
          <div className="flex gap-4 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
            <span className="text-gray-500 dark:text-gray-400 w-40 shrink-0 text-sm">Berufe</span>
            <div className="flex flex-wrap gap-1.5">
              {person.occupations.map((occ, i) => (
                <span key={i} className="px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-full text-xs text-indigo-700 dark:text-indigo-300">
                  {occ}
                </span>
              ))}
            </div>
          </div>
        )}
        {person.sources && person.sources.length > 0 && (
          <div className="flex gap-4 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
            <span className="text-gray-500 dark:text-gray-400 w-40 shrink-0 text-sm">Quellen</span>
            <div className="space-y-1 flex-1">
              {person.sources.map((src, i) => (
                <div key={i} className="text-xs px-2.5 py-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300">
                  📄 {src}
                </div>
              ))}
            </div>
          </div>
        )}
        {person.biography && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Biografie</p>
            <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{person.biography}</p>
          </div>
        )}
      </div>

      {/* Photo Gallery */}
      <PhotoGallery personId={id!} />

      {/* Computed Relatives */}
      {(parentIds.length + childIds.length + partnerIds.length + siblingIds.length) > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Verwandte</h2>
          <div className="space-y-3">
            {[
              { label: 'Eltern', ids: parentIds, color: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
              { label: 'Partner', ids: partnerIds, color: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300' },
              { label: 'Kinder', ids: childIds, color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
              { label: 'Geschwister', ids: siblingIds, color: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
            ].filter(g => g.ids.length > 0).map(group => (
              <div key={group.label} className="flex items-start gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 mt-1 ${group.color}`}>
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-2">
                  {group.ids.map(pid => {
                    const p = personById[pid]
                    if (!p) return null
                    return (
                      <Link key={pid} to={`/persons/${pid}`}
                        className="flex items-center gap-2 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 border border-gray-200 dark:border-gray-700 transition-colors">
                        {p.avatar_media_id ? (
                          <img src={mediaApi.fileUrl(p.avatar_media_id, { thumb: true })} alt=""
                            loading="lazy"
                            className="w-6 h-6 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">
                            {p.first_name[0]}{p.last_name[0]}
                          </div>
                        )}
                        <span className="text-sm text-gray-700 dark:text-gray-200">{p.first_name} {p.last_name}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Relationship Path Finder */}
      {allPersons.length > 1 && (
        <RelPathFinder currentId={id!} allPersons={allPersons} allRels={allRels} />
      )}

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
