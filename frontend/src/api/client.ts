import axios from 'axios'
import type { Person, PersonCreate, Relationship, RelationshipCreate, TreeData, MediaItem, GedcomImportResult, ExtractionResult } from '../types'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,  // send httpOnly cookie on every request
})

// On 401 (not from login itself), redirect to root so App re-checks auth status
api.interceptors.response.use(
  res => res,
  err => {
    if (
      err.response?.status === 401 &&
      !err.config?.url?.includes('/auth/login')
    ) {
      window.location.href = '/'
    }
    return Promise.reject(err)
  },
)

export const authApi = {
  status: () =>
    api.get<{ auth_enabled: boolean; authenticated: boolean }>('/auth/status').then(r => r.data),
  login: (password: string) =>
    api.post<{ access_token: string; token_type: string }>('/auth/login', { password }).then(r => r.data),
  logout: () =>
    api.post('/auth/logout').then(r => r.data),
}

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
    return api.post<{ id: string; person_id: string }>(`/persons/${personId}/media/avatar`, form).then(r => r.data)
  },
  uploadPhoto: (personId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ id: string; person_id: string }>(`/persons/${personId}/media`, form).then(r => r.data)
  },
  uploadDocument: (personId: string, file: File, title?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (title) form.append('title', title)
    return api.post<{ id: string; person_id: string }>(`/persons/${personId}/media/document`, form).then(r => r.data)
  },
  listPersonMedia: (personId: string) =>
    api.get<MediaItem[]>(`/persons/${personId}/media`, { params: { limit: 500 } }).then(r => r.data),
  deleteMedia: (mediaId: string) => api.delete(`/media/${mediaId}`),
  setAvatar: (personId: string, mediaId: string) =>
    api.patch(`/persons/${personId}/avatar/${mediaId}`).then(r => r.data),
  fileUrl: (mediaId: string, opts?: { thumb?: boolean }) =>
    `/api/v1/media/${mediaId}/file${opts?.thumb ? '?thumb=true' : ''}`,
}

export const aiApi = {
  status: () => api.get<{ available: boolean }>('/ai/status').then(r => r.data),
  extractDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<ExtractionResult>('/ai/extract-document', form).then(r => r.data)
  },
}

export const gedcomApi = {
  exportUrl: (anonymizeLiving = false) =>
    `/api/v1/gedcom/export${anonymizeLiving ? '?anonymize_living=true' : ''}`,
  import: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<GedcomImportResult>('/gedcom/import', form).then(r => r.data)
  },
}

export const exportApi = {
  jsonExportUrl: (anonymizeLiving = false) =>
    `/api/v1/export/json${anonymizeLiving ? '?anonymize_living=true' : ''}`,
  importJson: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<GedcomImportResult>('/import/json', form).then(r => r.data)
  },
}
