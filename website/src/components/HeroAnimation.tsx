import { motion } from 'framer-motion'

const PLATFORMS = [
  { id: 'x', color: '#1DA1F2', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { id: 'facebook', color: '#4267B2', path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
  { id: 'instagram', color: '#E4405F', path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z' },
  { id: 'youtube', color: '#FF0000', path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
  { id: 'linkedin', color: '#0A66C2', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
  { id: 'reddit', color: '#FF4500', path: 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z' },
]

// Randomized orbit parameters for each platform (seeded for consistency)
const ORBIT_PARAMS = [
  { duration: 55, direction: 1 },   // X - clockwise
  { duration: 70, direction: -1 },  // Facebook - counter-clockwise
  { duration: 48, direction: 1 },   // Instagram - clockwise
  { duration: 65, direction: -1 },  // YouTube - counter-clockwise
  { duration: 52, direction: 1 },   // LinkedIn - clockwise
  { duration: 60, direction: -1 },  // Reddit - counter-clockwise
]

const orbitRadius = 140

// Generate spiral waypoints from a platform position to center
function generateSpiralWaypoints(startAngle: number, spiralTurns: number = 1.5) {
  const steps = 12
  const waypoints: { x: number; y: number }[] = []
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // Spiral inward: radius decreases, angle increases
    const radius = orbitRadius * (1 - t * 0.85)
    const angle = startAngle + t * spiralTurns * Math.PI * 2
    waypoints.push({
      x: 200 + radius * Math.cos(angle),
      y: 200 + radius * Math.sin(angle),
    })
  }
  
  return waypoints
}

// Create particles for each platform - 3 particles per platform with staggered timing
const SPIRAL_PARTICLES = PLATFORMS.flatMap((platform, platformIndex) => {
  const baseAngle = ((platformIndex * 360) / PLATFORMS.length - 90) * (Math.PI / 180)
  const particlesPerPlatform = 3
  
  return Array.from({ length: particlesPerPlatform }, (_, particleIndex) => {
    // Alternate spiral direction for visual interest
    const spiralDirection = platformIndex % 2 === 0 ? 1.5 : -1.5
    const waypoints = generateSpiralWaypoints(baseAngle, spiralDirection)
    
    return {
      id: `${platform.id}-${particleIndex}`,
      platformIndex,
      waypoints,
      delay: particleIndex * 1.2 + platformIndex * 0.3,
      duration: 3 + Math.random() * 0.5,
    }
  })
})

export default function HeroAnimation() {
  const iconSize = 20

  return (
    <div className="relative w-full aspect-square max-w-md mx-auto">
      <svg viewBox="0 0 400 400" className="w-full h-full">
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="centerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0" />
            <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="iconGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="particleGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer rotating ring - larger */}
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '200px 200px' }}
        >
          <circle
            cx="200"
            cy="200"
            r="190"
            fill="none"
            stroke="url(#ringGradient)"
            strokeWidth="1"
            strokeDasharray="15 8"
          />
        </motion.g>

        {/* Connection lines from center outward */}
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <motion.line
            key={angle}
            x1="200"
            y1="200"
            x2="200"
            y2="30"
            stroke="url(#lineGradient)"
            strokeWidth="1"
            transform={`rotate(${angle} 200 200)`}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: [0, 0.4, 0] }}
            transition={{
              duration: 3,
              repeat: Infinity,
              delay: angle / 120,
              ease: 'easeInOut',
            }}
          />
        ))}

        {/* Spiral particles emerging from each platform logo */}
        {SPIRAL_PARTICLES.map((particle) => (
          <motion.circle
            key={particle.id}
            r="4"
            fill="#8b5cf6"
            filter="url(#particleGlow)"
            initial={{
              cx: particle.waypoints[0].x,
              cy: particle.waypoints[0].y,
              opacity: 0,
              scale: 0,
            }}
            animate={{
              cx: particle.waypoints.map((w) => w.x),
              cy: particle.waypoints.map((w) => w.y),
              opacity: [0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.7, 0.4, 0.1, 0, 0],
              scale: [0, 1, 1, 1, 1, 1, 1, 1, 0.8, 0.5, 0.2, 0, 0],
            }}
            transition={{
              duration: particle.duration,
              repeat: Infinity,
              delay: particle.delay,
              ease: 'linear',
            }}
          />
        ))}

        {/* Platform icons orbiting - slow random rotation */}
        {PLATFORMS.map((platform, i) => {
          const angle = (i * 360) / PLATFORMS.length - 90
          const angleRad = (angle * Math.PI) / 180
          const cx = 200 + orbitRadius * Math.cos(angleRad)
          const cy = 200 + orbitRadius * Math.sin(angleRad)
          const { duration, direction } = ORBIT_PARAMS[i]

          return (
            <motion.g
              key={platform.id}
              animate={{ rotate: 360 * direction }}
              transition={{
                duration: duration,
                repeat: Infinity,
                ease: 'linear',
              }}
              style={{ transformOrigin: '200px 200px' }}
            >
              {/* Icon background circle */}
              <circle
                cx={cx}
                cy={cy}
                r="22"
                fill={`${platform.color}20`}
                stroke={`${platform.color}50`}
                strokeWidth="2"
                filter="url(#iconGlow)"
              />
              {/* Platform icon - counter-rotate to stay upright */}
              <motion.g
                animate={{ rotate: -360 * direction }}
                transition={{
                  duration: duration,
                  repeat: Infinity,
                  ease: 'linear',
                }}
                style={{ transformOrigin: `${cx}px ${cy}px` }}
              >
                <g transform={`translate(${cx - iconSize / 2}, ${cy - iconSize / 2}) scale(${iconSize / 24})`}>
                  <path d={platform.path} fill={platform.color} />
                </g>
              </motion.g>
            </motion.g>
          )
        })}

        {/* Pulsing center glow */}
        <motion.circle
          cx="200"
          cy="200"
          r="55"
          fill="url(#centerGradient)"
          opacity="0.15"
          filter="url(#glow)"
          animate={{
            r: [55, 62, 55],
            opacity: [0.15, 0.25, 0.15],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Center square */}
        <rect
          x="155"
          y="155"
          width="90"
          height="90"
          rx="16"
          fill="url(#centerGradient)"
          filter="url(#glow)"
        />

        {/* Center F */}
        <text
          x="200"
          y="215"
          textAnchor="middle"
          fill="white"
          fontSize="48"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          F
        </text>

        {/* Purple pulse rings expanding from center */}
        {[1, 2, 3].map((i) => (
          <motion.rect
            key={`pulse-${i}`}
            x="155"
            y="155"
            width="90"
            height="90"
            rx="16"
            fill="none"
            stroke="#8b5cf6"
            strokeWidth="2"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{
              scale: [1, 1.8 + i * 0.3],
              opacity: [0.6, 0],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              delay: i * 0.5,
              ease: 'easeOut',
            }}
            style={{ transformOrigin: '200px 200px' }}
          />
        ))}
      </svg>
    </div>
  )
}
