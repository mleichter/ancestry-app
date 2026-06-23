import axios from 'axios'
import type { Person, PersonCreate, Relationship, RelationshipCreate, TreeData, MediaItem, GedcomImportResult } from '../types'

const api = axios.create({
  baseURL: '/api/v1',
})

export const personsApi = {
  list: () => api.get<Person[]>('/persons').then(r => r.data),
  get: (id: string) => api.get<Person>(`/persons/${id}`).then(r => r.data),
  create: (data: PersonCreate) => api.post<Person>('/persons', data).then(r => r.data),
  update: (id: string, data: Partial<PersonCreate>) =>
    api.patch<Person>(`/persons/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/persons/${id}`),
}

export const relationshipsApi = {
  list: (personId?: string) =>
    api.get<Relationship[]>('/relationships', { params: personId ? { person_id: personId } : {} }).then(r => r.data),
  create: (data: RelationshipCreate) => api.post<Relationship>('/relationships', data).then(r => r.data),
  delete: (id: string) => api.delete(`/relationships/${id}`),
}

export const treeApi = {
  get: () => api.get<TreeData>('/tree').then(r => r.data),
}

export const mediaApi = {
  uploadAvatar: (personId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/persons/${personId}/media/avatar`, form).then(r => r.data)
  },
  uploadPhoto: (personId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/persons/${personId}/media`, form).then(r => r.data)
  },
  listPersonMedia: (personId: string) =>
    api.get<MediaItem[]>(`/persons/${personId}/media`).then(r => r.data),
  deleteMedia: (mediaId: string) => api.delete(`/media/${mediaId}`),
  setAvatar: (personId: string, mediaId: string) =>
    api.patch(`/persons/${personId}/avatar/${mediaId}`).then(r => r.data),
  fileUrl: (mediaId: string) => `/api/v1/media/${mediaId}/file`,
}

export const gedcomApi = {
  exportUrl: () => '/api/v1/gedcom/export',
  import: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<GedcomImportResult>('/gedcom/import', form).then(r => r.data)
  },
}

export const exportApi = {
  jsonExportUrl: () => '/api/v1/export/json',
  importJson: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<GedcomImportResult>('/import/json', form).then(r => r.data)
  },
}
