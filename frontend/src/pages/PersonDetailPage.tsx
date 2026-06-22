import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { personsApi, relationshipsApi } from '../api/client'
import type { RelationshipCreate, RelationshipType } from '../types'

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-4 py-2 border-b border-gray-100 last:border-0">
      <span className="text-gray-500 w-40 shrink-0 text-sm">{label}</span>
      <span className="text-gray-800 text-sm">{value}</span>
    </div>
  )
}

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showRelForm, setShowRelForm] = useState(false)

  const { data: person, isLoading } = useQuery({
    queryKey: ['persons', id],
    queryFn: () => personsApi.get(id!),
  })
  const { data: allPersons = [] } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })
  const { data: rels = [] } = useQuery({
    queryKey: ['relationships', id],
    queryFn: () => relationshipsApi.list(id),
  })

  const deletePersonMutation = useMutation({
    mutationFn: () => personsApi.delete(id!),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['persons'] }); navigate('/persons') },
  })
  const addRelMutation = useMutation({
    mutationFn: (data: RelationshipCreate) => relationshipsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['relationships', id] }); setShowRelForm(false) },
  })
  const deleteRelMutation = useMutation({
    mutationFn: (relId: string) => relationshipsApi.delete(relId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['relationships', id] }),
  })

  const { register, handleSubmit, reset } = useForm<{ person_b_id: string; type: RelationshipType }>()

  if (isLoading) return <div className="text-center py-12 text-gray-500">Lade...</div>
  if (!person) return <div className="text-center py-12 text-red-500">Person nicht gefunden</div>

  const otherPersons = allPersons.filter(p => p.id !== id)
  const relatedIds = new Set(rels.flatMap(r => [r.person_a_id, r.person_b_id]))
  const personById = Object.fromEntries(allPersons.map(p => [p.id, p]))

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{person.first_name} {person.last_name}</h1>
          {person.birth_name && <p className="text-gray-500 text-sm mt-1">geb. {person.birth_name}</p>}
        </div>
        <div className="flex gap-2">
          <Link to={`/persons/${id}/edit`} className="px-4 py-2 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 text-sm">
            Bearbeiten
          </Link>
          <button
            onClick={() => { if (confirm('Person löschen?')) deletePersonMutation.mutate() }}
            className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm"
          >
            Löschen
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-6">
        <h2 className="font-semibold text-gray-700 mb-3">Personendaten</h2>
        <InfoRow label="Geschlecht" value={person.gender} />
        <InfoRow label="Geburtsdatum" value={person.date_of_birth} />
        <InfoRow label="Geburtsort" value={person.place_of_birth} />
        <InfoRow label="Sterbedatum" value={person.date_of_death} />
        <InfoRow label="Sterbeort" value={person.place_of_death} />
        <InfoRow label="Nationalität" value={person.nationality} />
        <InfoRow label="Herkunft" value={person.origin} />
        {person.biography && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-sm text-gray-500 mb-1">Biografie</p>
            <p className="text-sm text-gray-800 whitespace-pre-line">{person.biography}</p>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-gray-700">Beziehungen</h2>
          <button onClick={() => setShowRelForm(!showRelForm)} className="text-sm text-indigo-600 hover:underline">
            + Beziehung hinzufügen
          </button>
        </div>

        {showRelForm && (
          <form
            onSubmit={handleSubmit(data => addRelMutation.mutate({ ...data, person_a_id: id! }))}
            className="bg-indigo-50 rounded-lg p-4 mb-4 flex gap-3 flex-wrap items-end"
          >
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Person</label>
              <select {...register('person_b_id', { required: true })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">– wählen –</option>
                {otherPersons.map(p => (
                  <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Art</label>
              <select {...register('type', { required: true })}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm">
                <option value="">– wählen –</option>
                <option value="parent_child">Elternteil → Kind</option>
                <option value="partner">Partner</option>
              </select>
            </div>
            <button type="submit" className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm hover:bg-indigo-700">
              Hinzufügen
            </button>
            <button type="button" onClick={() => { setShowRelForm(false); reset() }} className="text-sm text-gray-500 hover:text-gray-700">
              Abbrechen
            </button>
          </form>
        )}

        {rels.length === 0 ? (
          <p className="text-sm text-gray-400">Keine Beziehungen vorhanden.</p>
        ) : (
          <div className="space-y-2">
            {rels.map(rel => {
              const otherId = rel.person_a_id === id ? rel.person_b_id : rel.person_a_id
              const other = personById[otherId]
              const isParent = rel.type === 'parent_child'
              const isA = rel.person_a_id === id
              return (
                <div key={rel.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isParent ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'}`}>
                      {isParent ? (isA ? 'Elternteil von' : 'Kind von') : 'Partner von'}
                    </span>
                    <Link to={`/persons/${otherId}`} className="text-sm font-medium text-gray-700 hover:text-indigo-600">
                      {other ? `${other.first_name} ${other.last_name}` : otherId}
                    </Link>
                  </div>
                  <button
                    onClick={() => deleteRelMutation.mutate(rel.id)}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
