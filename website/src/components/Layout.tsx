import { Outlet } from 'react-router-dom'
import Navigation from './Navigation'
import Footer from './Footer'

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      {/* Noise texture overlay */}
      <div className="noise-overlay" />
      
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-glow-purple/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-glow-blue/10 blur-[100px]" />
        <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] rounded-full bg-glow-cyan/5 blur-[80px]" />
      </div>
      
      <Navigation />
      
      <main className="flex-grow relative z-10">
        <Outlet />
      </main>
      
      <Footer />
    </div>
  )
}
