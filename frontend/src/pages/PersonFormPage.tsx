import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { personsApi } from '../api/client'
import type { PersonCreate } from '../types'

const dateField = z
  .string()
  .refine(v => !v || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v), {
    message: 'Format: JJJJ, JJJJ-MM oder JJJJ-MM-TT',
  })
  .optional()

const schema = z.object({
  first_name: z.string().min(1, 'Pflichtfeld'),
  last_name: z.string().min(1, 'Pflichtfeld'),
  birth_name: z.string().optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  date_of_birth: dateField,
  place_of_birth: z.string().optional(),
  date_of_death: dateField,
  place_of_death: z.string().optional(),
  is_living: z.boolean().default(true),
  nationality: z.string().optional(),
  origin: z.string().optional(),
  biography: z.string().optional(),
})

type FormData = z.infer<typeof schema>

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function OccupationsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) { onChange([...value, t]); setDraft('') }
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Beruf eingeben + Enter"
          className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none"
        />
        <button type="button" onClick={add}
          className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600">
          +
        </button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((occ, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-full text-xs text-indigo-700 dark:text-indigo-300">
              {occ}
              <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 ml-0.5">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PersonFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = Boolean(id)
  const [occupations, setOccupations] = useState<string[]>([])

  const { data: existing } = useQuery({
    queryKey: ['persons', id],
    queryFn: () => personsApi.get(id!),
    enabled: isEdit,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { is_living: true },
  })

  useEffect(() => {
    if (existing) {
      reset({ ...existing, gender: existing.gender ?? undefined })
      setOccupations(existing.occupations ?? [])
    }
  }, [existing, reset])

  const createMutation = useMutation({
    mutationFn: (data: PersonCreate) => personsApi.create(data),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['persons'] }); navigate(`/persons/${p.id}`) },
  })
  const updateMutation = useMutation({
    mutationFn: (data: Partial<PersonCreate>) => personsApi.update(id!, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['persons'] }); navigate(`/persons/${id}`) },
  })

  const onSubmit = (data: FormData) => {
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '' && v !== undefined))
    const payload = { ...clean, ...(occupations.length > 0 ? { occupations } : {}) }
    if (isEdit) updateMutation.mutate(payload as Partial<PersonCreate>)
    else createMutation.mutate(payload as unknown as PersonCreate)
  }

  const input = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 focus:border-indigo-400 outline-none'

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">{isEdit ? 'Person bearbeiten' : 'Neue Person'}</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Vorname *" error={errors.first_name?.message}>
            <input {...register('first_name')} className={input} />
          </Field>
          <Field label="Nachname *" error={errors.last_name?.message}>
            <input {...register('last_name')} className={input} />
          </Field>
        </div>
        <Field label="Geburtsname">
          <input {...register('birth_name')} className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Geschlecht">
            <select {...register('gender')} className={input}>
              <option value="">– bitte wählen –</option>
              <option value="male">Männlich</option>
              <option value="female">Weiblich</option>
              <option value="other">Divers</option>
              <option value="unknown">Unbekannt</option>
            </select>
          </Field>
          <Field label="Lebt noch">
            <div className="flex items-center h-10">
              <input type="checkbox" {...register('is_living')} className="w-4 h-4 text-indigo-600 rounded mr-2" />
              <span className="text-sm text-gray-600 dark:text-gray-300">Person lebt noch</span>
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Geburtsdatum" error={errors.date_of_birth?.message}>
            <input {...register('date_of_birth')} placeholder="JJJJ-MM-TT" className={input} />
          </Field>
          <Field label="Geburtsort">
            <input {...register('place_of_birth')} className={input} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Sterbedatum" error={errors.date_of_death?.message}>
            <input {...register('date_of_death')} placeholder="JJJJ-MM-TT" className={input} />
          </Field>
          <Field label="Sterbeort">
            <input {...register('place_of_death')} className={input} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nationalität">
            <input {...register('nationality')} className={input} />
          </Field>
          <Field label="Herkunft">
            <input {...register('origin')} className={input} />
          </Field>
        </div>
        <Field label="Berufe">
          <OccupationsEditor value={occupations} onChange={setOccupations} />
        </Field>
        <Field label="Biografie">
          <textarea {...register('biography')} rows={4} className={input + ' resize-none'} />
        </Field>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
            {isEdit ? 'Speichern' : 'Anlegen'}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="px-6 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  )
}
