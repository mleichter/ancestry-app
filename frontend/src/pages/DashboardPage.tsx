import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi, relationshipsApi, mediaApi } from '../api/client'

const yearInt = (d: string) => parseInt(/^\d{4}/.test(d) ? d : d.slice(-4))

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${color}`}>
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-3xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const { data: persons = [] } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })
  const { data: rels = [] } = useQuery({ queryKey: ['relationships'], queryFn: () => relationshipsApi.list() })

  const stats = useMemo(() => {
    const living   = persons.filter(p => p.is_living).length
    const deceased = persons.length - living
    const partners = rels.filter(r => r.type === 'partner').length
    const parent_child = rels.filter(r => r.type === 'parent_child').length

    const birthYears = persons
      .filter(p => p.date_of_birth)
      .map(p => yearInt(p.date_of_birth!))
      .filter(y => !isNaN(y))
    const deathYears = persons
      .filter(p => p.date_of_death)
      .map(p => yearInt(p.date_of_death!))
      .filter(y => !isNaN(y))
    const minYear = birthYears.length ? Math.min(...birthYears) : null
    const maxYear = deathYears.length ? Math.max(...deathYears) : null
    const span = minYear && maxYear ? `${minYear} – ${maxYear}` : minYear ? `ab ${minYear}` : null

    // Top surnames
    const surnameCounts: Record<string, number> = {}
    for (const p of persons) {
      const name = (p.birth_name || p.last_name).trim()
      if (name) surnameCounts[name] = (surnameCounts[name] || 0) + 1
    }
    const topSurnames = Object.entries(surnameCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
    const maxSurnameCount = topSurnames[0]?.[1] ?? 1

    // Nationalities
    const natCounts: Record<string, number> = {}
    for (const p of persons) {
      if (p.nationality) natCounts[p.nationality] = (natCounts[p.nationality] || 0) + 1
    }
    const topNats = Object.entries(natCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

    // Recent additions (last 5 by created_at)
    const recent = [...persons]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5)

    return { living, deceased, partners, parent_child, span, topSurnames, maxSurnameCount, topNats, recent }
  }, [persons, rels])

  if (persons.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <div className="text-6xl mb-6">🌳</div>
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100 mb-3">Willkommen im Stammbaum</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">Legen Sie die erste Person an, um Ihren Stammbaum zu beginnen.</p>
        <Link to="/persons/new"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-medium transition-colors">
          Erste Person anlegen
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Übersicht</h1>
        {stats.span && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Zeitraum: {stats.span}</p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Personen" value={persons.length}
          color="bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700" />
        <StatCard label="Lebend" value={stats.living}
          color="bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" />
        <StatCard label="Verstorben" value={stats.deceased}
          color="bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700" />
        <StatCard label="Beziehungen" value={rels.length}
          sub={`${stats.partners} Partner · ${stats.parent_child} Eltern`}
          color="bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900" />
      </div>

      {/* Bottom two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Surnames */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Häufigste Nachnamen</h2>
          {stats.topSurnames.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">Keine Daten.</p>
          ) : (
            <div className="space-y-2">
              {stats.topSurnames.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200 w-32 shrink-0 truncate">{name}</span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 dark:bg-indigo-600 rounded-full transition-all"
                      style={{ width: `${(count / stats.maxSurnameCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-400 dark:text-gray-500 w-6 text-right shrink-0">{count}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
            <Link to="/surnames"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              Alle Nachnamen →
            </Link>
          </div>
        </div>

        {/* Recent additions */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Zuletzt hinzugefügt</h2>
          <div className="space-y-2">
            {stats.recent.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-1">
                {p.avatar_media_id ? (
                  <img src={mediaApi.fileUrl(p.avatar_media_id)} alt=""
                    className="w-8 h-8 rounded-full object-cover border border-gray-200 dark:border-gray-600 shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-400 dark:text-gray-500 shrink-0">
                    {p.first_name[0]}{p.last_name[0]}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Link to={`/persons/${p.id}`}
                    className="text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-indigo-600 dark:hover:text-indigo-400 truncate block">
                    {p.first_name} {p.last_name}
                  </Link>
                  {p.date_of_birth && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">* {p.date_of_birth.slice(0, 4)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex gap-4">
            <Link to="/persons" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              Alle Personen →
            </Link>
            <Link to="/persons/new" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
              + Neue Person
            </Link>
          </div>
        </div>

      </div>

      {/* Nationalities */}
      {stats.topNats.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
          <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">Nationalitäten</h2>
          <div className="flex flex-wrap gap-2">
            {stats.topNats.map(([nat, count]) => (
              <span key={nat}
                className="px-3 py-1 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 rounded-full text-sm text-indigo-700 dark:text-indigo-300">
                {nat} <span className="text-indigo-400 dark:text-indigo-500 ml-1">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quick nav */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { to: '/tree',     icon: '🌳', label: 'Stammbaum' },
          { to: '/timeline', icon: '📅', label: 'Zeitleiste' },
          { to: '/surnames', icon: '👨‍👩‍👧‍👦', label: 'Familien' },
          { to: '/gedcom',   icon: '📁', label: 'GEDCOM' },
        ].map(item => (
          <Link key={item.to} to={item.to}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 text-center hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md transition-all group">
            <div className="text-2xl mb-1 group-hover:scale-110 transition-transform inline-block">{item.icon}</div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
