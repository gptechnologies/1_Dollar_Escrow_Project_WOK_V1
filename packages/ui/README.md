# Temp-Escrow UI

A "Temp-Mail" style interface for creating instant, session-based cryptocurrency escrows with a stunning 3D animated background.

## Features

- **Zero Login Friction**: No authentication required - instant access
- **Session-Based**: 10-minute auto-expiring sessions
- **3D Immersive Background**: Interactive Spline scene
- **Modern UI**: Floating glass-morphic design with smooth animations
- **Responsive**: Works seamlessly on desktop and mobile

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **3D Graphics**: Spline (@splinetool/react-spline)
- **State Management**: Zustand
- **Animations**: Framer Motion
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
cd packages/ui
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Build for Production

```bash
npm run build
npm start
```

## Project Structure

```
packages/ui/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Main page with integrated components
│   └── globals.css         # Global styles
├── components/
│   ├── SplineHero.tsx      # 3D background component
│   ├── CreateEscrowCard.tsx # Main escrow form
│   ├── SessionDashboard.tsx # Escrow list view
│   └── SessionTimer.tsx    # Session countdown timer
├── store/
│   └── useSessionStore.ts  # Zustand session state
└── lib/
    └── utils.ts            # Utility functions
```

## Key Components

### SplineHero
Interactive 3D background that responds to mouse movement. Loads asynchronously with a gradient fallback.

### CreateEscrowCard
Floating form card for creating escrows with:
- Role selection (Buyer/Seller)
- Amount input (USDC)
- Counterparty address
- Description field

### SessionDashboard
Clean list view of all escrows created in the current session.

### SessionTimer
Countdown display showing time remaining before session reset.

## Session Management

- Sessions automatically reset after 10 minutes of inactivity
- Activity is tracked via mouse movement, keypresses, and clicks
- All escrow data is stored in-memory (Zustand) and resets with the session

## Customization

### Spline Scene
To use a different 3D scene, update the URL in `components/SplineHero.tsx`:

```typescript
<Spline 
  scene="https://prod.spline.design/YOUR_SCENE_URL/scene.splinecode" 
  onLoad={() => setIsLoading(false)}
/>
```

### Session Duration
To change the session duration, update `SESSION_DURATION` in `store/useSessionStore.ts`:

```typescript
const SESSION_DURATION = 10 * 60 * 1000; // 10 minutes
```

## Performance Notes

- The Spline scene is loaded asynchronously to prevent blocking the UI
- Mobile devices show the same 3D scene (consider adding a static fallback if needed)
- All animations use GPU-accelerated transforms for smooth performance

## License

Part of the Escrow Smart Contract monorepo.
