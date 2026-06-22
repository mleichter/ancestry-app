import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import PersonListPage from './pages/PersonListPage'
import PersonFormPage from './pages/PersonFormPage'
import PersonDetailPage from './pages/PersonDetailPage'
import TreePage from './pages/TreePage'

function Nav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-200'}`
  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shadow-sm">
      <span className="text-lg font-bold text-indigo-700 mr-4">🌳 Stammbaum</span>
      <NavLink to="/persons" className={cls}>Personen</NavLink>
      <NavLink to="/tree" className={cls}>Stammbaum</NavLink>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 p-6">
          <Routes>
            <Route path="/" element={<TreePage />} />
            <Route path="/persons" element={<PersonListPage />} />
            <Route path="/persons/new" element={<PersonFormPage />} />
            <Route path="/persons/:id" element={<PersonDetailPage />} />
            <Route path="/persons/:id/edit" element={<PersonFormPage />} />
            <Route path="/tree" element={<TreePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
