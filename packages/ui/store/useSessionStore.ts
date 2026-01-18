import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Escrow {
  id: string;
  escrowAddress: string;
  code: string;
  payout: string;      // seller
  funder: string;      // buyer
  amount: string;
  deadline: Date;
  confirmDeadline: number;
  createdAt: Date;
  status: 'pending' | 'confirmed' | 'funded' | 'resolved' | 'expired';
}

interface SessionState {
  sessionId: string;
  expiryTime: number;
  isActive: boolean;
  escrows: Escrow[];
  
  // Actions
  resetSession: () => void;
  touchSession: () => void;
  addEscrow: (escrow: Omit<Escrow, 'id' | 'createdAt' | 'status'>) => void;
  updateEscrowStatus: (id: string, status: Escrow['status']) => void;
}

const generateSessionId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes (real escrows, not session-based)

const getInitialState = () => {
  if (typeof window === 'undefined') {
    return {
      sessionId: generateSessionId(),
      expiryTime: Date.now() + SESSION_DURATION,
      isActive: true,
      escrows: [],
    };
  }

  const stored = sessionStorage.getItem('escrow-session');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed.expiryTime > Date.now()) {
        return {
          ...parsed,
          escrows: parsed.escrows.map((e: any) => ({
            ...e,
            createdAt: new Date(e.createdAt),
            deadline: new Date(e.deadline),
          })),
        };
      }
    } catch (e) {
      console.error('Failed to parse session storage:', e);
    }
  }

  return {
    sessionId: generateSessionId(),
    expiryTime: Date.now() + SESSION_DURATION,
    isActive: true,
    escrows: [],
  };
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      ...getInitialState(),
      
      resetSession: () => {
        const newState = {
          sessionId: generateSessionId(),
          expiryTime: Date.now() + SESSION_DURATION,
          isActive: true,
          escrows: [],
        };
        set(newState);
      },
      
      touchSession: () => {
        set((state) => ({
          expiryTime: Date.now() + SESSION_DURATION,
          isActive: true,
        }));
      },
      
      addEscrow: (escrowData) => {
        const newId = typeof crypto !== 'undefined' && crypto.randomUUID 
          ? crypto.randomUUID() 
          : 'escrow_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
        
        set((state) => ({
          escrows: [
            ...state.escrows,
            {
              ...escrowData,
              id: newId,
              createdAt: new Date(),
              status: 'pending',
            },
          ],
        }));
      },
      
      updateEscrowStatus: (id, status) => {
        set((state) => ({
          escrows: state.escrows.map((escrow) =>
            escrow.id === id ? { ...escrow, status } : escrow
          ),
        }));
      },
    }),
    {
      name: 'escrow-session',
      storage: {
        getItem: (name) => {
          if (typeof window === 'undefined') return null;
          const str = sessionStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              escrows: state.escrows?.map((e: any) => ({
                ...e,
                createdAt: new Date(e.createdAt),
                deadline: new Date(e.deadline),
              })) || [],
            },
          };
        },
        setItem: (name, value) => {
          if (typeof window === 'undefined') return;
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          if (typeof window === 'undefined') return;
          sessionStorage.removeItem(name);
        },
      },
    }
  )
);
