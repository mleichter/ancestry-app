import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { personsApi } from '../api/client'

export default function PersonListPage() {
  const qc = useQueryClient()
  const { data: persons = [], isLoading } = useQuery({
    queryKey: ['persons'],
    queryFn: personsApi.list,
  })
  const deleteMutation = useMutation({
    mutationFn: personsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['persons'] }),
  })

  if (isLoading) return <div className="text-center py-12 text-gray-500">Lade Personen...</div>

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Personen</h1>
        <Link to="/persons/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
          + Person hinzufügen
        </Link>
      </div>

      {persons.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">Noch keine Personen vorhanden.</p>
          <Link to="/persons/new" className="mt-4 inline-block text-indigo-600 hover:underline">
            Erste Person anlegen
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {persons.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
              <div>
                <Link to={`/persons/${p.id}`} className="font-semibold text-gray-800 hover:text-indigo-600 text-lg">
                  {p.first_name} {p.last_name}
                </Link>
                <div className="text-sm text-gray-500 mt-1 flex gap-4">
                  {p.date_of_birth && <span>* {p.date_of_birth}</span>}
                  {p.date_of_death && <span>† {p.date_of_death}</span>}
                  {p.gender && <span className="capitalize">{p.gender}</span>}
                  {!p.is_living && !p.date_of_death && <span className="text-gray-400">verstorben</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <Link to={`/persons/${p.id}/edit`} className="px-3 py-1 text-sm text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50">
                  Bearbeiten
                </Link>
                <button
                  onClick={() => { if (confirm(`${p.first_name} ${p.last_name} löschen?`)) deleteMutation.mutate(p.id) }}
                  className="px-3 py-1 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50"
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
