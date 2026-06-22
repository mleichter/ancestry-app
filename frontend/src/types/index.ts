export type Gender = 'male' | 'female' | 'other' | 'unknown'
export type RelationshipType = 'parent_child' | 'partner'
export type EndReason = 'divorce' | 'death' | 'annulment'

export interface Person {
  id: string
  first_name: string
  last_name: string
  birth_name?: string
  gender?: Gender
  date_of_birth?: string
  place_of_birth?: string
  date_of_death?: string
  place_of_death?: string
  is_living: boolean
  nationality?: string
  origin?: string
  occupations?: string[]
  biography?: string
  avatar_media_id?: string
  created_at: string
  updated_at: string
}

export interface PersonCreate {
  first_name: string
  last_name: string
  birth_name?: string
  gender?: Gender
  date_of_birth?: string
  place_of_birth?: string
  date_of_death?: string
  place_of_death?: string
  is_living?: boolean
  nationality?: string
  origin?: string
  occupations?: string[]
  biography?: string
}

export interface Relationship {
  id: string
  person_a_id: string
  person_b_id: string
  type: RelationshipType
  start_date?: string
  end_date?: string
  end_reason?: EndReason
  notes?: string
  created_at: string
  updated_at: string
}

export interface RelationshipCreate {
  person_a_id: string
  person_b_id: string
  type: RelationshipType
  start_date?: string
  end_date?: string
  end_reason?: EndReason
  notes?: string
}

export interface TreeNode {
  id: string
  label: string
  gender?: Gender
  date_of_birth?: string
  date_of_death?: string
  is_living: boolean
  avatar_media_id?: string
}

export interface TreeEdge {
  id: string
  source: string
  target: string
  type: string
  label?: string
}

export interface TreeData {
  nodes: TreeNode[]
  edges: TreeEdge[]
}

export interface MediaItem {
  id: string
  person_id: string
  file_name: string
  media_type: string
  mime_type: string
  uploaded_at: string
}

export interface GedcomImportResult {
  persons_created: number
  relationships_created: number
}
