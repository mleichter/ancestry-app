import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PersonListPage from './pages/PersonListPage'
import PersonFormPage from './pages/PersonFormPage'
import PersonDetailPage from './pages/PersonDetailPage'
import TreePage from './pages/TreePage'
import TimelinePage from './pages/TimelinePage'
import GedcomPage from './pages/GedcomPage'
import DashboardPage from './pages/DashboardPage'
import SurnamesPage from './pages/SurnamesPage'
import SettingsPage from './pages/SettingsPage'
import SearchPage from './pages/SearchPage'
import { ToastProvider } from './hooks/useToast'

function Nav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded font-medium transition-colors text-sm ${
      isActive
        ? 'bg-indigo-600 text-white'
        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`
  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center gap-2 shadow-sm flex-wrap">
      <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 mr-4">🌳 Stammbaum</span>
      <NavLink to="/" end className={cls}>Übersicht</NavLink>
      <NavLink to="/persons" className={cls}>Personen</NavLink>
      <NavLink to="/tree" className={cls}>Stammbaum</NavLink>
      <NavLink to="/timeline" className={cls}>Zeitleiste</NavLink>
      <NavLink to="/surnames" className={cls}>Familien</NavLink>
      <NavLink to="/gedcom" className={cls}>GEDCOM</NavLink>
      <NavLink to="/search" className={cls}>Suche</NavLink>
      <NavLink to="/settings" className={cls}>Einstellungen</NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <ToastProvider>
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/persons" element={<PersonListPage />} />
            <Route path="/persons/new" element={<PersonFormPage />} />
            <Route path="/persons/:id" element={<PersonDetailPage />} />
            <Route path="/persons/:id/edit" element={<PersonFormPage />} />
            <Route path="/tree" element={<TreePage />} />
            <Route path="/timeline" element={<TimelinePage />} />
            <Route path="/surnames" element={<SurnamesPage />} />
            <Route path="/gedcom" element={<GedcomPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
    </ToastProvider>
  )
}
