'use client';

import Spline from '@splinetool/react-spline/next';
import { useState } from 'react';

export default function SplineHero() {
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  return (
    <div className="fixed inset-0 overflow-hidden z-0 pointer-events-none">
      {/* Fallback (loading / error) */}
      {(isLoading || loadError) && (
        <div className="absolute inset-0 bg-[url('/clouds.png')] bg-cover bg-center bg-no-repeat z-10 transition-opacity duration-700" />
      )}

      {/* Spline Scene (all viewports) */}
      {!loadError && (
        <div
          className={`w-full h-full transition-opacity duration-1000 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
        >
          <Spline
            scene="/scene.splinecode"
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
