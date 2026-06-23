import { useSettings } from '../hooks/useSettings'

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-4 cursor-pointer group py-4 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <div className="relative shrink-0 mt-0.5">
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
        />
        <div
          className={`w-10 h-6 rounded-full transition-colors ${
            checked ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        />
        <div
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
      </div>
    </label>
  )
}

export default function SettingsPage() {
  const { settings, update } = useSettings()

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Einstellungen</h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm mb-6">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Datenschutz</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Einstellungen zum Schutz der Privatsphäre lebender Personen.
        </p>
        <Toggle
          label="Lebende Personen beim Export anonymisieren"
          description="Namen, Daten und Biografie lebender Personen werden in GEDCOM- und JSON-Exporten durch Platzhalter ersetzt. Beziehungen bleiben erhalten."
          checked={settings.anonymize_living}
          onChange={v => update({ anonymize_living: v })}
        />
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm">
        <h2 className="font-semibold text-gray-700 dark:text-gray-300 mb-4">Über die Anwendung</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-4">
            <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">Version</dt>
            <dd className="text-gray-800 dark:text-gray-200">{__APP_VERSION__}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">Stack</dt>
            <dd className="text-gray-800 dark:text-gray-200">FastAPI · PostgreSQL · React · D3</dd>
          </div>
          <div className="flex gap-4">
            <dt className="text-gray-500 dark:text-gray-400 w-32 shrink-0">Quellcode</dt>
            <dd>
              <a
                href="https://github.com/mleichter/ancestry-app"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                github.com/mleichter/ancestry-app
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
