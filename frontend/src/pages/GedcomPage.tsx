import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { gedcomApi, exportApi } from '../api/client'
import { useSettings } from '../hooks/useSettings'
import type { GedcomImportResult } from '../types'

type Tab = 'gedcom' | 'json'

function ImportZone({ onImport, isPending, isError, result }: {
  onImport: (file: File) => void
  isPending: boolean
  isError: boolean
  result: GedcomImportResult | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
      >
        {isPending ? (
          <p className="text-gray-500 dark:text-gray-400">Importiere…</p>
        ) : (
          <>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Datei hier ablegen oder klicken</p>
          </>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onImport(f)
          e.target.value = ''
        }}
      />
      {isError && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          Fehler beim Import. Bitte Dateiformat prüfen.
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
    </>
  )
}

export default function GedcomPage() {
  const qc = useQueryClient()
  const { settings } = useSettings()
  const [tab, setTab] = useState<Tab>('gedcom')
  const [gedcomResult, setGedcomResult] = useState<GedcomImportResult | null>(null)
  const [jsonResult, setJsonResult] = useState<GedcomImportResult | null>(null)

  const gedcomImport = useMutation({
    mutationFn: (file: File) => gedcomApi.import(file),
    onSuccess: (data) => {
      setGedcomResult(data)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
  })

  const jsonImport = useMutation({
    mutationFn: (file: File) => exportApi.importJson(file),
    onSuccess: (data) => {
      setJsonResult(data)
      qc.invalidateQueries({ queryKey: ['persons'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
    },
  })

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
      tab === t
        ? 'bg-indigo-600 text-white'
        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Import / Export</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Stammbaum-Daten importieren und exportieren.
      </p>

      {/* Tab switcher */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setTab('gedcom')} className={tabCls('gedcom')}>GEDCOM 5.5.1</button>
        <button onClick={() => setTab('json')} className={tabCls('json')}>JSON</button>
      </div>

      {tab === 'gedcom' && (
        <div className="space-y-6">
          {/* GEDCOM Export */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Exportieren</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Alle Personen und Beziehungen als GEDCOM-Datei (kompatibel mit Ancestry, MyHeritage, FamilySearch).
            </p>
            {settings.anonymize_living && (
              <p className="mb-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                Anonymisierung aktiv — lebende Personen werden ohne persönliche Daten exportiert.
              </p>
            )}
            <a
              href={gedcomApi.exportUrl(settings.anonymize_living)}
              download="stammbaum.ged"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              ↓ stammbaum.ged herunterladen
            </a>
          </div>

          {/* GEDCOM Import */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Importieren</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              GEDCOM-Datei (.ged) hochladen. Bestehende Daten bleiben erhalten.
            </p>
            <ImportZone
              onImport={f => { setGedcomResult(null); gedcomImport.mutate(f) }}
              isPending={gedcomImport.isPending}
              isError={gedcomImport.isError}
              result={gedcomResult}
            />
          </div>
        </div>
      )}

      {tab === 'json' && (
        <div className="space-y-6">
          {/* JSON Export */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Exportieren</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Alle Daten als JSON exportieren. Eignet sich als Backup oder für eigene Weiterverarbeitung.
            </p>
            {settings.anonymize_living && (
              <p className="mb-3 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                Anonymisierung aktiv — lebende Personen werden ohne persönliche Daten exportiert.
              </p>
            )}
            <a
              href={exportApi.jsonExportUrl(settings.anonymize_living)}
              download="stammbaum.json"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              ↓ stammbaum.json herunterladen
            </a>
          </div>

          {/* JSON Import */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
            <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Importieren</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Stammbaum.json hochladen. Personen und Beziehungen werden hinzugefügt (kein Überschreiben).
            </p>
            <ImportZone
              onImport={f => { setJsonResult(null); jsonImport.mutate(f) }}
              isPending={jsonImport.isPending}
              isError={jsonImport.isError}
              result={jsonResult}
            />
          </div>
        </div>
      )}
    </div>
  )
}
