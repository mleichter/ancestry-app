import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { gedcomApi } from '../api/client'
import type { GedcomImportResult } from '../types'

export default function GedcomPage() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<GedcomImportResult | null>(null)

  const importMutation = useMutation({
    mutationFn: (file: File) => gedcomApi.import(file),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
  })

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">GEDCOM Import / Export</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        GEDCOM 5.5.1 ist das Standardformat für Genealogie-Daten (Ancestry, MyHeritage, FamilySearch).
      </p>

      {/* Export */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm mb-6">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Exportieren</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Alle Personen und Beziehungen als GEDCOM-Datei herunterladen.
        </p>
        <a
          href={gedcomApi.exportUrl()}
          download="stammbaum.ged"
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
        >
          <span>↓</span> stammbaum.ged herunterladen
        </a>
      </div>

      {/* Import */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Importieren</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          GEDCOM-Datei hochladen, um Personen und Beziehungen zu importieren. Bestehende Daten bleiben erhalten.
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
        >
          {importMutation.isPending ? (
            <p className="text-gray-500 dark:text-gray-400">Importiere…</p>
          ) : (
            <>
              <p className="text-gray-500 dark:text-gray-400 text-sm">
                .ged Datei hier ablegen oder klicken
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">GEDCOM 5.5.1</p>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".ged,.gedcom"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) { setResult(null); importMutation.mutate(f) }
            e.target.value = ''
          }}
        />

        {importMutation.isError && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
            Fehler beim Import. Bitte prüfen Sie das Dateiformat.
          </div>
        )}

        {result && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="font-semibold text-green-800 dark:text-green-300 text-sm mb-1">Import erfolgreich</p>
            <ul className="text-sm text-green-700 dark:text-green-400 space-y-0.5">
              <li>{result.persons_created} Personen importiert</li>
              <li>{result.relationships_created} Beziehungen importiert</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
