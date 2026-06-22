import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi, mediaApi } from '../api/client'

const GENDER_LABEL: Record<string, string> = {
  male: 'männlich', female: 'weiblich', other: 'divers', unknown: 'unbekannt',
}

export default function PersonListPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: personsApi.list,
  })
  const deleteMutation = useMutation({
    mutationFn: personsApi.delete,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return persons
    return persons.filter(p =>
      `${p.first_name} ${p.last_name} ${p.birth_name ?? ''}`.toLowerCase().includes(q)
    )
  }, [persons, search])

  const living = persons.filter(p => p.is_living).length
  const deceased = persons.length - living

  if (isLoading) return <div className="text-center py-12 text-gray-500">Lade Personen...</div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Personen</h1>
          {persons.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              {persons.length} gesamt · {living} lebend · {deceased} verstorben
            </p>
          )}
        </div>
        <Link to="/persons/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
          + Person hinzufügen
        </Link>
      </div>

      {persons.length > 0 && (
        <input
          type="search"
          placeholder="Nach Name suchen…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full mb-4 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
        />
      )}

      {persons.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">Noch keine Personen vorhanden.</p>
          <Link to="/persons/new" className="mt-4 inline-block text-indigo-600 hover:underline">
            Erste Person anlegen
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-8 text-gray-400">Keine Personen gefunden für „{search}"</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
              {p.avatar_media_id ? (
                <img src={mediaApi.fileUrl(p.avatar_media_id)} alt=""
                  className="w-10 h-10 rounded-full object-cover border border-gray-200 shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 text-sm font-medium shrink-0">
                  {p.first_name[0]}{p.last_name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <Link to={`/persons/${p.id}`} className="font-semibold text-gray-800 hover:text-indigo-600">
                  {p.first_name} {p.last_name}
                  {p.birth_name && <span className="text-gray-400 font-normal text-sm"> (geb. {p.birth_name})</span>}
                </Link>
                <div className="text-xs text-gray-500 mt-0.5 flex gap-3 flex-wrap">
                  {p.gender && <span>{GENDER_LABEL[p.gender] ?? p.gender}</span>}
                  {p.date_of_birth && <span>* {p.date_of_birth}</span>}
                  {p.date_of_death && <span>† {p.date_of_death}</span>}
                  {!p.is_living && !p.date_of_death && <span>verstorben</span>}
                  {p.place_of_birth && <span>{p.place_of_birth}</span>}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link to={`/persons/${p.id}/edit`} className="px-3 py-1 text-xs text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50">
                  Bearbeiten
                </Link>
                <button
                  onClick={() => { if (confirm(`${p.first_name} ${p.last_name} löschen?`)) deleteMutation.mutate(p.id) }}
                  className="px-3 py-1 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
                >
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
