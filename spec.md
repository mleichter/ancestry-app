# Family Tree Application – Project Specification

**Version:** 1.0  
**Status:** Implemented (2026-06-25)  
**Datum:** 2026-06-22

---

## 1. Projektziel

Entwicklung einer selbst gehosteten Web-Applikation zur Verwaltung und visuellen Darstellung eines Familienstammbaumes. Die Applikation soll es ermöglichen, Familienmitglieder mit ihren biographischen Daten zu erfassen, Beziehungen zwischen Personen zu pflegen und den Stammbaum interaktiv im Browser darzustellen.

---

## 2. Architektur-Überblick

```
┌─────────────────────────────────────────────────────┐
│                   Docker Compose                    │
│                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌───────┐  │
│  │   Frontend   │───▶│   Backend    │───▶│  DB   │  │
│  │  React (SPA) │    │ FastAPI (Py) │    │       │  │
│  │   Port 3000  │    │   Port 8000  │    │       │  │
│  └──────────────┘    └──────────────┘    └───────┘  │
│                             │                       │
│                      ┌──────────────┐               │
│                      │  Media Store │               │
│                      │ (Volume/S3)  │               │
│                      └──────────────┘               │
└─────────────────────────────────────────────────────┘
```

### 2.1 Tech Stack

| Komponente | Technologie | Begründung |
|---|---|---|
| Backend | Python 3.12 + FastAPI | Async-fähig, OpenAPI auto-gen, typsicher via Pydantic |
| Frontend | React 18 + TypeScript | Komponentenmodell ideal für Graph-UI |
| Datenbank | PostgreSQL (primary) | Relationale Integrität für Personen/Beziehungen; alternativ SQLite für leichtgewichtigen Start |
| ORM | SQLAlchemy 2.x + Alembic | Migrationen, DB-Agnostik |
| Visualisierung | React Flow (Graph) + D3.js (Tree) | React Flow für interaktiven Graph; D3 für klassische Baumansicht |
| Container | Docker + Docker Compose | Homelab-Deployment |
| Media Storage | Lokales Volume (erweiterbar auf S3) | Fotos und Dokumente |

> **Datenbankentscheidung:** PostgreSQL wird empfohlen. Für initiale Entwicklung kann SQLite via Feature-Flag aktiviert werden. Die Beziehungsstruktur des Stammbaums wird als Adjazenzliste in einer relationalen DB modelliert – einfacher als Graph-DB, ausreichend für diesen Use Case.

---

## 3. Datenmodell

### 3.1 Entity: `Person`

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | UUID | ✓ | Primärschlüssel |
| `first_name` | String(100) | ✓ | Vorname(n) |
| `last_name` | String(100) | ✓ | Nachname (aktuell) |
| `birth_name` | String(100) | – | Geburtsname / Mädchenname |
| `gender` | Enum | – | `male`, `female`, `other`, `unknown` |
| `date_of_birth` | Date | – | Geburtsdatum (teilweise Daten erlaubt: nur Jahr) |
| `place_of_birth` | String(200) | – | Geburtsort |
| `date_of_death` | Date | – | Sterbedatum (null = lebend) |
| `place_of_death` | String(200) | – | Sterbeort |
| `is_living` | Boolean | ✓ | Explizites Flag (Datenschutz) |
| `nationality` | String(100) | – | Nationalität / Staatsangehörigkeit |
| `origin` | String(200) | – | Ethnische / regionale Herkunft |
| `occupations` | JSON Array | – | Liste von Berufen (mit optionalen Zeiträumen) |
| `biography` | Text | – | Freitext-Biographie / Notizen |
| `avatar_media_id` | UUID FK | – | Referenz auf primäres Profilfoto |
| `created_at` | DateTime | ✓ | Automatisch |
| `updated_at` | DateTime | ✓ | Automatisch |

### 3.2 Entity: `Relationship`

Beziehungen werden als gerichtete Kanten modelliert.

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | UUID | ✓ | Primärschlüssel |
| `person_a_id` | UUID FK | ✓ | Erste Person |
| `person_b_id` | UUID FK | ✓ | Zweite Person |
| `type` | Enum | ✓ | Beziehungstyp (s.u.) |
| `start_date` | Date | – | Beginn der Beziehung (z.B. Heiratsdatum) |
| `end_date` | Date | – | Ende der Beziehung (z.B. Scheidungsdatum) |
| `end_reason` | Enum | – | `divorce`, `death`, `annulment` |
| `notes` | Text | – | Freitext |

**Beziehungstypen (`type`):**
- `parent_child` – Eltern-Kind (biologisch); `person_a` = Elternteil, `person_b` = Kind
- `partner` – Ehe oder Partnerschaft (undirected, beide Richtungen gültig)

> **Hinweis Geschwister:** Geschwister werden nicht direkt gespeichert, sondern aus gemeinsamen Elternteilen abgeleitet (computed relationship). Das vereinfacht das Datenmodell erheblich und verhindert Inkonsistenzen.

### 3.3 Entity: `Media`

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `id` | UUID | ✓ | Primärschlüssel |
| `person_id` | UUID FK | ✓ | Zugehörige Person |
| `file_name` | String | ✓ | Originaldateiname |
| `file_path` | String | ✓ | Interner Speicherpfad |
| `media_type` | Enum | ✓ | `photo`, `document` |
| `mime_type` | String | ✓ | MIME-Type (image/jpeg, application/pdf, …) |
| `title` | String | – | Beschreibung / Titel |
| `date_taken` | Date | – | Aufnahmedatum |
| `uploaded_at` | DateTime | ✓ | Automatisch |

---

## 4. API-Spezifikation (REST)

Alle Endpunkte unter `/api/v1/`. OpenAPI-Dokumentation automatisch via FastAPI unter `/docs`.

### 4.1 Personen

| Method | Endpoint | Beschreibung |
|---|---|---|
| `GET` | `/persons` | Liste aller Personen (paginiert, filterbar) |
| `POST` | `/persons` | Neue Person anlegen |
| `GET` | `/persons/{id}` | Einzelne Person abrufen |
| `PUT` | `/persons/{id}` | Person vollständig aktualisieren |
| `PATCH` | `/persons/{id}` | Person partiell aktualisieren |
| `DELETE` | `/persons/{id}` | Person löschen (mit Cascade-Optionen) |
| `GET` | `/persons/{id}/relatives` | Alle Verwandten berechnet abrufen |
| `GET` | `/persons/{id}/media` | Medien einer Person |

### 4.2 Beziehungen

| Method | Endpoint | Beschreibung |
|---|---|---|
| `GET` | `/relationships` | Alle Beziehungen |
| `POST` | `/relationships` | Neue Beziehung anlegen |
| `GET` | `/relationships/{id}` | Einzelne Beziehung |
| `PUT` | `/relationships/{id}` | Beziehung aktualisieren |
| `DELETE` | `/relationships/{id}` | Beziehung löschen |

### 4.3 Stammbaum / Graph

| Method | Endpoint | Beschreibung |
|---|---|---|
| `GET` | `/tree` | Gesamten Graphen als Nodes+Edges abrufen |
| `GET` | `/tree/{person_id}` | Teilgraph zentriert auf Person (konfigurierbare Tiefe) |

### 4.4 Medien

| Method | Endpoint | Beschreibung |
|---|---|---|
| `POST` | `/persons/{id}/media` | Datei hochladen (multipart/form-data) |
| `GET` | `/media/{id}` | Datei abrufen / streamen |
| `DELETE` | `/media/{id}` | Datei löschen |

### 4.5 Import / Export

| Method | Endpoint | Beschreibung |
|---|---|---|
| `GET` | `/export/gedcom` | Gesamten Baum als GEDCOM 5.5.5 exportieren |
| `GET` | `/export/json` | Gesamten Baum als JSON exportieren |
| `POST` | `/import/gedcom` | GEDCOM-Datei importieren |
| `POST` | `/import/json` | JSON-Datei importieren |

> PDF-Export (Stammbaum-Druck) wird im Frontend generiert (client-side, z.B. via `react-to-pdf` oder `jsPDF` + Canvas-Rendering des Graphen).

---

## 5. Frontend – Seitenstruktur & Komponenten

### 5.1 Routen

| Route | Komponente | Beschreibung |
|---|---|---|
| `/` | `TreeView` | Hauptansicht – Stammbaum-Visualisierung |
| `/persons` | `PersonList` | Tabellarische Personenliste mit Suche/Filter |
| `/persons/new` | `PersonForm` | Neue Person anlegen |
| `/persons/:id` | `PersonDetail` | Detailansicht mit Medien und Beziehungen |
| `/persons/:id/edit` | `PersonForm` | Person bearbeiten |
| `/import-export` | `ImportExport` | Import/Export-Verwaltung |
| `/settings` | `Settings` | App-Einstellungen |

### 5.2 Kernkomponenten

**`TreeView`** (Hauptkomponente)
- Toggle zwischen zwei Ansichtsmodi:
  - **Graph-Modus** (React Flow): Interaktiver, frei positionierbarer Graph. Knoten = Personen, Kanten = Beziehungen. Zoom, Pan, Drag. Farbcodierung nach Beziehungstyp.
  - **Baum-Modus** (D3): Klassische hierarchische Top-Down-Ansicht. Ausgangspunkt wählbar.
- Klick auf Person → Sidebar mit Kurzinfo + Link zur Detailseite
- Doppelklick → direkt zur Detailseite

**`PersonCard`** (Knoten im Graph)
- Avatar / Foto
- Name (Geburtsname in Klammern falls abweichend)
- Lebensdaten kompakt (YYYY – YYYY bzw. * YYYY)
- Visueller Indikator: lebend / verstorben

**`PersonForm`**
- Alle Pflicht- und optionalen Felder
- Beziehungen direkt beim Anlegen verknüpfbar (Eltern, Partner)
- Avatar-Upload inline
- Validierung client-seitig (react-hook-form + zod)

**`PersonDetail`**
- Vollständige Biographie-Anzeige
- Medien-Galerie (Fotos + Dokumente)
- Beziehungs-Übersicht (abgeleitet: Eltern, Kinder, Geschwister, Partner)
- Direktlink zum Bearbeiten

### 5.3 UI-Design-Richtlinien

- Framework: **Tailwind CSS** + **shadcn/ui** Komponentenbibliothek
- Responsiv (Desktop-first, Mobile-kompatibel)
- Dark Mode Support
- Sprache der UI: Deutsch (i18n-fähige Struktur für spätere Erweiterung)

---

## 6. Nicht-funktionale Anforderungen

### 6.1 Sicherheit
- Single-user JWT-Authentifizierung implementiert (httpOnly SameSite=Strict Cookie, optionales `AUTH_PASSWORD`/`AUTH_SECRET_KEY` in `.env`)
- Statischer API-Key (`API_KEY`) für programmatischen Zugriff (MCP etc.)
- Security-Header via nginx (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP)
- Datei-Upload: Magic-Byte-Validierung (python-magic), maximale Dateigröße konfigurierbar (default: 20 MB)
- Eingabe-Validierung via Pydantic-Constraints auf allen Endpunkten

### 6.2 Performance
- Paginierung für Personenliste (default: 50 pro Seite)
- Lazy Loading für Medien (Thumbnails für Fotos)
- Graph-API liefert nur Nodes/Edges, keine vollständigen Personenobjekte (separate Detailabrufe)
- Datenbankindizes auf: `person_id`, `relationship.person_a_id`, `relationship.person_b_id`

### 6.3 Datenschutz
- `is_living`-Flag: Lebende Personen können in Export-Funktionen anonymisiert werden (konfigurierbar)
- Keine externen Dienste / Tracking

### 6.4 Erweiterbarkeit
- Klare Trennung Backend/Frontend (API-first)
- Alembic-Migrationen für alle DB-Änderungen
- Feature-Flags via Umgebungsvariablen (`.env`)

---

## 7. Deployment

### 7.1 Docker Compose Struktur

```yaml
# docker-compose.yml (Zielstruktur)
services:
  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    environment:
      - VITE_API_URL=http://backend:8000

  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      - DATABASE_URL=postgresql://...
      - MEDIA_STORAGE_PATH=/data/media
    volumes:
      - media_data:/data/media
    depends_on: [db]

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=familytree
      - POSTGRES_USER=familytree
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data

volumes:
  pg_data:
  media_data:
```

### 7.2 Konfiguration via `.env`

```
DB_PASSWORD=<secret>
MEDIA_STORAGE_PATH=/data/media
MAX_UPLOAD_SIZE_MB=20
LIVING_PERSONS_ANONYMIZE_IN_EXPORT=true
```

---

## 8. Repository-Struktur

```
family-tree/
├── README.md
├── SPEC.md                  ← Diese Datei
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
│
├── backend/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── alembic/
│   │   └── versions/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── models/          ← SQLAlchemy Models
│       │   ├── person.py
│       │   ├── relationship.py
│       │   └── media.py
│       ├── schemas/         ← Pydantic Schemas
│       ├── routers/         ← FastAPI Router
│       │   ├── persons.py
│       │   ├── relationships.py
│       │   ├── tree.py
│       │   ├── media.py
│       │   └── import_export.py
│       └── services/        ← Business Logic
│           ├── tree_builder.py
│           ├── gedcom.py
│           └── media.py
│
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/             ← API-Client (generated oder manuell)
        ├── components/
        │   ├── tree/
        │   │   ├── GraphView.tsx
        │   │   └── TreeView.tsx
        │   ├── persons/
        │   │   ├── PersonCard.tsx
        │   │   ├── PersonForm.tsx
        │   │   └── PersonDetail.tsx
        │   └── ui/          ← shadcn/ui re-exports
        ├── pages/
        └── stores/          ← Zustand / React Query
```

---

## 9. Implementierungs-Phasen (für Agenten-Handoff)

### Phase 1 – Foundation
- [x] Repo-Struktur aufsetzen
- [x] Docker Compose (dev + prod)
- [x] FastAPI Grundgerüst + Health-Endpoint
- [x] PostgreSQL-Anbindung + Alembic-Setup
- [x] SQLAlchemy-Modelle: Person, Relationship, Media

### Phase 2 – Backend Core
- [x] CRUD-Endpunkte für Personen
- [x] CRUD-Endpunkte für Beziehungen
- [x] Tree-Builder-Service (Graph-Aufbau, Geschwister-Ableitung)
- [x] `/tree` und `/tree/{id}` Endpunkte
- [x] Media-Upload und -Abruf

### Phase 3 – Frontend Core
- [x] React + Vite + Tailwind Setup
- [x] React Query API-Client
- [x] PersonList + PersonForm + PersonDetail
- [x] Graph-Ansicht (React Flow)
- [x] Baum-Ansicht (D3) + Toggle

### Phase 4 – Import/Export
- [x] GEDCOM 5.5.1 Parser (Import)
- [x] GEDCOM Exporter
- [x] JSON Import/Export
- [ ] PDF-Export (client-side) — nicht implementiert

### Phase 5 – Polish
- [x] Dark Mode
- [x] Validierung und Fehlerbehandlung (Frontend + Backend)
- [x] Thumbnail-Generierung für Fotos (Pillow)
- [ ] E2E-Tests (Playwright) — nicht implementiert
- [x] Dokumentation (README, API-Docs)

### Phase 6 – Post-MVP (implementiert)
- [x] JWT-Authentifizierung (httpOnly Cookie)
- [x] Security-Hardening (Headers, Magic-Byte-Validierung, Input-Constraints)
- [x] Performance (GZip, DB-Pool, Indexes, Paginierung)
- [x] AI-Dokumentenextraktion (GPT-4o + MediaPipe Portraiterkennung)

---

## 10. Offene Entscheidungen / Tech Debt bewusst akzeptiert

| Thema | Entscheidung | Begründung |
|---|---|---|
| Authentifizierung | Single-user JWT implementiert | Optional via `AUTH_PASSWORD` in `.env` |
| DB-Wahl | PostgreSQL (SQLite als Alt.) | Flexibel via `DATABASE_URL` |
| Graph-Layout-Algorithmus | React Flow Auto-Layout (Dagre) | Erweiterbar auf eigene Layouts |
| GEDCOM-Version | 5.5.5 (nicht GEDCOM X) | Breiteste Kompatibilität mit bestehender Software |
| i18n | Deutsch hardcoded in v1.0 | Struktur i18n-ready (react-i18next vorbereiten) |

---

*Ende der Spezifikation – bereit für Agentic Coding Handoff.*
