import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Manifesto from './pages/Manifesto'
import NewsletterModal from './components/NewsletterModal'
import ScrollToTop from './components/ScrollToTop'
import { NewsletterProvider, useNewsletter } from './context/NewsletterContext'

function AppContent() {
  const { isOpen, closeModal } = useNewsletter()

  return (
    <>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="manifesto" element={<Manifesto />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <NewsletterModal isOpen={isOpen} onClose={closeModal} />
    </>
  )
}

function App() {
  return (
    <NewsletterProvider>
      <AppContent />
    </NewsletterProvider>
  )
}

export default App
