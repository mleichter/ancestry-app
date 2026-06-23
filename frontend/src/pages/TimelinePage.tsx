import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi, relationshipsApi } from '../api/client'
import type { Person, Relationship } from '../types'

const yearInt = (d: string) => parseInt(/^\d{4}/.test(d) ? d : d.slice(-4))

type EventType = 'birth' | 'death' | 'union' | 'separation'

interface TimelineEvent {
  date: string
  year: number
  type: EventType
  person?: Person
  personA?: Person
  personB?: Person
  place?: string
  notes?: string
}

function eventLabel(ev: TimelineEvent, personById: Record<string, Person>): string {
  switch (ev.type) {
    case 'birth': return `${ev.person?.first_name} ${ev.person?.last_name} geboren`
    case 'death': return `${ev.person?.first_name} ${ev.person?.last_name} gestorben`
    case 'union': {
      const a = ev.personA, b = ev.personB
      return `${a?.first_name} ${a?.last_name} & ${b?.first_name} ${b?.last_name}`
    }
    case 'separation': {
      const a = ev.personA, b = ev.personB
      return `${a?.first_name} ${a?.last_name} & ${b?.first_name} ${b?.last_name} getrennt`
    }
  }
}

const TYPE_CONFIG: Record<EventType, { icon: string; color: string; label: string }> = {
  birth:     { icon: '✦', color: 'text-emerald-600 dark:text-emerald-400', label: 'Geburt' },
  death:     { icon: '✝', color: 'text-gray-500 dark:text-gray-400',       label: 'Tod' },
  union:     { icon: '♥', color: 'text-pink-500 dark:text-pink-400',        label: 'Partnerschaft' },
  separation:{ icon: '✕', color: 'text-orange-500 dark:text-orange-400',   label: 'Trennung' },
}

const FILTER_TYPES: { value: EventType | 'all'; label: string }[] = [
  { value: 'all',        label: 'Alle' },
  { value: 'birth',      label: 'Geburten' },
  { value: 'death',      label: 'Todesfälle' },
  { value: 'union',      label: 'Partnerschaften' },
  { value: 'separation', label: 'Trennungen' },
]

export default function TimelinePage() {
  const [typeFilter, setTypeFilter] = useState<EventType | 'all'>('all')
  const [search, setSearch] = useState('')

  const { data: persons = [] } = useQuery({ queryKey: ['persons'], queryFn: personsApi.list })
  const { data: rels = [] } = useQuery({ queryKey: ['relationships'], queryFn: () => relationshipsApi.list() })

  const personById = useMemo(
    () => Object.fromEntries(persons.map(p => [p.id, p])),
    [persons]
  )

  const events = useMemo(() => {
    const evs: TimelineEvent[] = []

    for (const p of persons) {
      if (p.date_of_birth) {
        evs.push({ date: p.date_of_birth, year: yearInt(p.date_of_birth), type: 'birth', person: p, place: p.place_of_birth })
      }
      if (p.date_of_death) {
        evs.push({ date: p.date_of_death, year: yearInt(p.date_of_death), type: 'death', person: p, place: p.place_of_death })
      }
    }

    for (const rel of rels) {
      if (rel.type !== 'partner') continue
      const a = personById[rel.person_a_id]
      const b = personById[rel.person_b_id]
      if (rel.start_date) {
        evs.push({ date: rel.start_date, year: yearInt(rel.start_date), type: 'union', personA: a, personB: b, notes: rel.notes || undefined })
      }
      if (rel.end_date) {
        evs.push({ date: rel.end_date, year: yearInt(rel.end_date), type: 'separation', personA: a, personB: b })
      }
    }

    return evs
      .filter(e => !isNaN(e.year))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [persons, rels, personById])

  const filtered = useMemo(() => {
    let evs = typeFilter === 'all' ? events : events.filter(e => e.type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      evs = evs.filter(e => {
        const label = eventLabel(e, personById).toLowerCase()
        return label.includes(q) || (e.place?.toLowerCase().includes(q) ?? false)
      })
    }
    return evs
  }, [events, typeFilter, search, personById])

  // Group by decade for section headers
  const withDecade = useMemo(() => {
    let lastDecade = -1
    return filtered.map(e => {
      const decade = Math.floor(e.year / 10) * 10
      const isNew = decade !== lastDecade
      lastDecade = decade
      return { ev: e, decade, isNew }
    })
  }, [filtered])

  if (!persons.length) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-gray-500">
        <p className="text-lg mb-2">Keine Personen vorhanden.</p>
        <Link to="/persons/new" className="text-indigo-600 dark:text-indigo-400 hover:underline">Erste Person anlegen</Link>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Zeitleiste</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} Ereignisse</span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTER_TYPES.map(f => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              typeFilter === f.value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <input
        type="search"
        placeholder="Suchen…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full mb-6 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none"
      />

      {filtered.length === 0 ? (
        <p className="text-center py-8 text-gray-400 dark:text-gray-500">Keine Ereignisse gefunden.</p>
      ) : (
        <div className="relative">
          {/* vertical line */}
          <div className="absolute left-[22px] top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />

          {withDecade.map(({ ev, decade, isNew }, i) => {
            const cfg = TYPE_CONFIG[ev.type]
            return (
              <div key={i}>
                {isNew && (
                  <div className="flex items-center gap-3 mb-3 mt-4 first:mt-0">
                    <div className="w-11 text-right text-xs font-bold text-gray-400 dark:text-gray-500 shrink-0">{decade}er</div>
                    <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  </div>
                )}
                <div className="flex gap-3 mb-3 group">
                  {/* dot */}
                  <div className={`w-11 shrink-0 flex justify-center pt-0.5`}>
                    <span className={`text-base ${cfg.color} bg-white dark:bg-gray-950 px-0.5`}>{cfg.icon}</span>
                  </div>
                  {/* card */}
                  <div className="flex-1 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2.5 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            ev.type === 'birth'      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                            ev.type === 'death'      ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' :
                            ev.type === 'union'      ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300' :
                                                       'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                          }`}>{cfg.label}</span>
                          <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
                            {ev.type === 'birth' || ev.type === 'death' ? (
                              <Link
                                to={`/persons/${ev.person?.id}`}
                                className="hover:text-indigo-600 dark:hover:text-indigo-400"
                              >
                                {ev.person?.first_name} {ev.person?.last_name}
                              </Link>
                            ) : (
                              <>
                                <Link to={`/persons/${ev.personA?.id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                                  {ev.personA?.first_name} {ev.personA?.last_name}
                                </Link>
                                {' & '}
                                <Link to={`/persons/${ev.personB?.id}`} className="hover:text-indigo-600 dark:hover:text-indigo-400">
                                  {ev.personB?.first_name} {ev.personB?.last_name}
                                </Link>
                              </>
                            )}
                          </span>
                        </div>
                        {ev.place && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">📍 {ev.place}</p>}
                        {ev.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic">{ev.notes}</p>}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 font-mono">{ev.date}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
