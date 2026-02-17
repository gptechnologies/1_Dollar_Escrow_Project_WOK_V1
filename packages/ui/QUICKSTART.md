# Crow UI - Quick Start Guide

## 🚀 Running the Application

### Option 1: From the UI directory
```bash
cd packages/ui
npm run dev
```

### Option 2: From the project root
```bash
npm run ui:dev
```

The application will be available at **http://localhost:3000**

## 🎯 What You'll See

### 1. Loading State
When you first load the page, you'll see a beautiful gradient background while the 3D Spline scene loads.

### 2. 3D Interactive Background
Once loaded, you'll see an animated 3D scene that responds to your mouse movements. This scene fills the top portion of the page.

### 3. Floating Escrow Card
A clean, white card floats above the 3D background with the following fields:
- **Role Selection**: Choose Buyer or Seller
- **Amount**: Enter USDC amount
- **Counterparty Address**: Enter the other party's address (0x...)
- **Description**: Describe what this escrow is for

### 4. Session Timer
In the top-right corner, you'll see a countdown timer (starts at 10:00). This resets whenever you interact with the page.

### 5. Dashboard
Below the fold, you'll see a list of all escrows you've created in this session.

## 🧪 Testing the Application

### Create an Escrow
1. Select your role (Buyer or Seller)
2. Enter an amount (e.g., "100.00")
3. Enter a counterparty address (e.g., "0x1234...")
4. Enter a description (e.g., "Payment for services")
5. Click "Create Escrow"
6. You'll see a loading state for 1.5 seconds
7. The escrow will appear in the dashboard below

### Session Management
1. The timer in the top-right shows time remaining
2. Any mouse movement, keypress, or click resets the timer to 10:00
3. When the timer reaches 0:00, the session resets and all escrows are cleared

### Responsive Design
- Try resizing your browser window
- The layout adapts for mobile, tablet, and desktop
- The 3D scene adjusts height on smaller screens

## 🎨 Visual Elements

### Color Scheme
- **Primary**: Indigo (#4F46E5)
- **Background**: Slate/White
- **Accents**: Purple gradient in loading state

### Typography
- **Sans**: Geist Sans (modern, clean)
- **Mono**: Geist Mono (for addresses)

### Shadows & Depth
- Cards have deep shadows (Apple-style)
- Glass-morphic effects on header elements
- Smooth fade transitions

## 🔧 Development Features

### Hot Reload
Any changes you make to the code will automatically reload in the browser.

### TypeScript
Full type safety across all components. Your IDE will provide autocomplete and error checking.

### Tailwind CSS
Utility-first CSS framework for rapid styling. All styles are defined inline in components.

## 📱 Mobile Testing

### Browser DevTools
1. Open DevTools (F12 or Cmd+Option+I)
2. Click the device toolbar icon
3. Select a mobile device
4. Test the responsive layout

### Real Device
If you're on the same network:
1. Find your local IP (e.g., 192.168.1.100)
2. Visit http://YOUR_IP:3000 on your mobile device

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Kill the process on port 3000
lsof -ti:3000 | xargs kill -9
```

### 3D Scene Not Loading
- Check your internet connection (Spline scene loads from CDN)
- Check browser console for errors
- Try hard refresh (Cmd+Shift+R or Ctrl+Shift+R)

### Build Errors
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

## 🎓 Next Steps

### Integrate with Smart Contracts
The form collects all necessary data:
- Role (buyer/seller)
- Amount (USDC)
- Counterparty address
- Description

Replace the mock submission in `CreateEscrowCard.tsx` with actual contract calls.

### Add Wallet Connection
Integrate with wagmi/viem for wallet connectivity:
```typescript
import { useAccount, useConnect } from 'wagmi'
```

### Deploy to Production
```bash
npm run build
npm start
```

Or deploy to Vercel:
```bash
npx vercel
```

## 📚 Key Files to Explore

| File | Purpose |
|------|---------|
| `app/page.tsx` | Main page layout |
| `components/CreateEscrowCard.tsx` | Form logic |
| `store/useSessionStore.ts` | State management |
| `components/SplineHero.tsx` | 3D background |

## 💡 Tips

1. **Activity Detection**: The session timer resets on any user interaction
2. **Form Validation**: All fields are required before submission
3. **Loading States**: Visual feedback during async operations
4. **Animations**: Powered by Framer Motion for smooth transitions
5. **Glass Effects**: Backdrop blur creates modern UI depth

## 🎉 Enjoy!

You now have a fully functional session-based escrow UI with a stunning 3D background. Happy coding!

