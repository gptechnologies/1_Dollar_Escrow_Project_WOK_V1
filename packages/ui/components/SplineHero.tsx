'use client';

import Spline from '@splinetool/react-spline';
import { useState, useEffect } from 'react';

export default function SplineHero() {
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden z-0 pointer-events-none">
      {/* Fallback (loading / mobile / error) */}
      {(isLoading || isMobile || loadError) && (
        <div className="absolute inset-0 bg-black z-10 transition-opacity duration-700" />
      )}

      {/* Spline Scene (Desktop only) */}
      {!isMobile && !loadError && (
        <div
          className={`w-full h-full transition-opacity duration-1000 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <Spline
            scene="https://prod.spline.design/nGSqWrf81ceKjyZ6/scene.splinecode"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setLoadError(true);
              setIsLoading(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
