import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi, mediaApi } from '../api/client'

const yearOf = (d: string) => /^\d{4}/.test(d) ? d.slice(0, 4) : d.slice(-4)

export default function SurnamesPage() {
  const [search, setSearch] = useState('')
  const { data: persons = [], isLoading } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })

  const groups = useMemo(() => {
    const map = new Map<string, typeof persons>()
    for (const p of persons) {
      const key = (p.birth_name || p.last_name).trim()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, members]) => ({
        name,
        members: members.sort((a, b) => {
          const ya = a.date_of_birth ? parseInt(a.date_of_birth) : 9999
          const yb = b.date_of_birth ? parseInt(b.date_of_birth) : 9999
          return ya - yb
        }),
      }))
  }, [persons])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return groups
    return groups.filter(g => g.name.toLowerCase().includes(q))
  }, [groups, search])

  if (isLoading) return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Lade…</div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Familiennamen</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">{groups.length} Namen</span>
      </div>

      <input
        type="search"
        placeholder="Namen suchen…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full mb-6 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none"
      />

      {filtered.length === 0 ? (
        <p className="text-center py-8 text-gray-400 dark:text-gray-500">Keine Familien gefunden.</p>
      ) : (
        <div className="space-y-4">
          {filtered.map(group => (
            <div key={group.name}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <h2 className="font-semibold text-gray-800 dark:text-gray-200">{group.name}</h2>
                <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded-full font-medium">
                  {group.members.length}
                </span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {group.members.map(p => (
                  <Link key={p.id} to={`/persons/${p.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 transition-colors group">
                    {p.avatar_media_id ? (
                      <img src={mediaApi.fileUrl(p.avatar_media_id)} alt=""
                        className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-600 shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">
                        {p.first_name[0]}{p.last_name[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        {p.first_name} {p.last_name}
                        {p.birth_name && p.birth_name !== group.name && (
                          <span className="text-gray-400 dark:text-gray-500 font-normal"> (geb. {p.birth_name})</span>
                        )}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 flex gap-3 shrink-0">
                      {p.date_of_birth && <span>* {yearOf(p.date_of_birth)}</span>}
                      {p.date_of_death && <span>† {yearOf(p.date_of_death)}</span>}
                      {!p.is_living && !p.date_of_death && <span>✝</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
