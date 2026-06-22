import axios from 'axios'
import type { Person, PersonCreate, Relationship, RelationshipCreate, TreeData } from '../types'

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
