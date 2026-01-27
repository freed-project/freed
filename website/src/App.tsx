import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Manifesto from './pages/Manifesto'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="manifesto" element={<Manifesto />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
