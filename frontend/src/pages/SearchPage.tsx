import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi, mediaApi } from '../api/client'

function highlight(text: string, q: string) {
  if (!q) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export default function SearchPage() {
  const [q, setQ] = useState('')
  const { data: persons = [] } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })

  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (term.length < 2) return []
    return persons.filter(p => {
      const fields = [
        p.first_name, p.last_name, p.birth_name,
        p.place_of_birth, p.place_of_death,
        p.nationality, p.origin, p.biography,
        ...(p.occupations ?? []),
        ...(p.sources ?? []),
      ]
      return fields.some(f => f?.toLowerCase().includes(term))
    })
  }, [q, persons])

  const matchField = (p: typeof persons[0], term: string) => {
    const checks: [string, string | undefined | null][] = [
      ['Geburtsort', p.place_of_birth],
      ['Sterbeort', p.place_of_death],
      ['Nationalität', p.nationality],
      ['Herkunft', p.origin],
      ['Biografie', p.biography],
    ]
    for (const [label, val] of checks) {
      if (val?.toLowerCase().includes(term)) return { label, val }
    }
    for (const occ of p.occupations ?? []) {
      if (occ.toLowerCase().includes(term)) return { label: 'Beruf', val: occ }
    }
    for (const src of p.sources ?? []) {
      if (src.toLowerCase().includes(term)) return { label: 'Quelle', val: src }
    }
    return null
  }

  const term = q.trim().toLowerCase()

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-4">Suche</h1>
      <input
        autoFocus
        type="search"
        placeholder="Name, Ort, Biografie, Quelle…"
        value={q}
        onChange={e => setQ(e.target.value)}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none shadow-sm mb-4"
      />

      {term.length >= 2 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
          {results.length === 0 ? 'Keine Ergebnisse.' : `${results.length} Ergebnis${results.length !== 1 ? 'se' : ''}`}
        </p>
      )}

      {term.length < 2 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
          Mindestens 2 Zeichen eingeben…
        </p>
      )}

      <div className="space-y-2">
        {results.map(p => {
          const extra = matchField(p, term)
          const nameMatch = `${p.first_name} ${p.last_name}`.toLowerCase().includes(term)
          return (
            <Link
              key={p.id}
              to={`/persons/${p.id}`}
              className="flex items-center gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-700 transition-all"
            >
              {p.avatar_media_id ? (
                <img src={mediaApi.fileUrl(p.avatar_media_id, { thumb: true })} alt=""
                  loading="lazy"
                  className="w-10 h-10 rounded-full object-cover border border-gray-200 dark:border-gray-600 shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm font-medium shrink-0">
                  {p.first_name[0]}{p.last_name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">
                  {nameMatch
                    ? highlight(`${p.first_name} ${p.last_name}`, q.trim())
                    : `${p.first_name} ${p.last_name}`}
                </p>
                {extra && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    <span className="font-medium text-indigo-500 dark:text-indigo-400">{extra.label}:</span>{' '}
                    {highlight(extra.val!, q.trim())}
                  </p>
                )}
                {!nameMatch && !extra && p.birth_name?.toLowerCase().includes(term) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    geb. {highlight(p.birth_name!, q.trim())}
                  </p>
                )}
              </div>
              {(p.date_of_birth || p.date_of_death) && (
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {p.date_of_birth?.slice(0, 4)}{p.date_of_death ? ` – ${p.date_of_death.slice(0, 4)}` : ''}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
