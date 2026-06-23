import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi, mediaApi } from '../api/client'

const GENDER_LABEL: Record<string, string> = {
  male: 'männlich', female: 'weiblich', other: 'divers', unknown: 'unbekannt',
}

type SortKey = 'name_asc' | 'name_desc' | 'birth_asc' | 'birth_desc' | 'added_desc'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name_asc',    label: 'Name A–Z' },
  { value: 'name_desc',   label: 'Name Z–A' },
  { value: 'birth_asc',   label: 'Älteste zuerst' },
  { value: 'birth_desc',  label: 'Jüngste zuerst' },
  { value: 'added_desc',  label: 'Zuletzt hinzugefügt' },
]

const yearOf = (d?: string) => d ? parseInt(/^\d{4}/.test(d) ? d : d.slice(-4)) : null

export default function PersonListPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('name_asc')

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
    let result = q
      ? persons.filter(p => `${p.first_name} ${p.last_name} ${p.birth_name ?? ''}`.toLowerCase().includes(q))
      : [...persons]

    result.sort((a, b) => {
      switch (sort) {
        case 'name_asc':
          return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
        case 'name_desc':
          return `${b.last_name} ${b.first_name}`.localeCompare(`${a.last_name} ${a.first_name}`)
        case 'birth_asc': {
          const ya = yearOf(a.date_of_birth) ?? 9999
          const yb = yearOf(b.date_of_birth) ?? 9999
          return ya - yb
        }
        case 'birth_desc': {
          const ya = yearOf(a.date_of_birth) ?? 0
          const yb = yearOf(b.date_of_birth) ?? 0
          return yb - ya
        }
        case 'added_desc':
          return b.created_at.localeCompare(a.created_at)
        default:
          return 0
      }
    })
    return result
  }, [persons, search, sort])

  const living  = persons.filter(p => p.is_living).length
  const deceased = persons.length - living

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Lade Personen…</div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Personen</h1>
          {persons.length > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {persons.length} gesamt · {living} lebend · {deceased} verstorben
            </p>
          )}
        </div>
        <Link to="/persons/new"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-medium">
          + Person hinzufügen
        </Link>
      </div>

      {persons.length > 0 && (
        <div className="flex gap-2 mb-4">
          <input
            type="search"
            placeholder="Nach Name suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none"
          />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none shrink-0"
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}

      {persons.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <p className="text-lg">Noch keine Personen vorhanden.</p>
          <Link to="/persons/new" className="mt-4 inline-block text-indigo-600 dark:text-indigo-400 hover:underline">
            Erste Person anlegen
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center py-8 text-gray-400 dark:text-gray-500">Keine Personen gefunden für „{search}"</p>
      ) : (
        <div className="grid gap-2">
          {filtered.map(p => (
            <div key={p.id}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow">
              {p.avatar_media_id ? (
                <img src={mediaApi.fileUrl(p.avatar_media_id, { thumb: true })} alt=""
                  className="w-10 h-10 rounded-full object-cover border border-gray-200 dark:border-gray-600 shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm font-medium shrink-0">
                  {p.first_name[0]}{p.last_name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <Link to={`/persons/${p.id}`}
                  className="font-semibold text-gray-800 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400">
                  {p.first_name} {p.last_name}
                  {p.birth_name && (
                    <span className="text-gray-400 dark:text-gray-500 font-normal text-sm"> (geb. {p.birth_name})</span>
                  )}
                </Link>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex gap-3 flex-wrap">
                  {p.gender && <span>{GENDER_LABEL[p.gender] ?? p.gender}</span>}
                  {p.date_of_birth && <span>* {p.date_of_birth}</span>}
                  {p.date_of_death && <span>† {p.date_of_death}</span>}
                  {!p.is_living && !p.date_of_death && <span>verstorben</span>}
                  {p.place_of_birth && <span>{p.place_of_birth}</span>}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Link to={`/persons/${p.id}/edit`}
                  className="px-3 py-1 text-xs text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                  Bearbeiten
                </Link>
                <button
                  onClick={() => { if (confirm(`${p.first_name} ${p.last_name} löschen?`)) deleteMutation.mutate(p.id) }}
                  className="px-3 py-1 text-xs text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/30">
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
