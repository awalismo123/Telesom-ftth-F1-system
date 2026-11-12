import React from 'react';
import { Wifi } from 'lucide-react';

/** First paint while the saved session is verified — branded, not a blank page. */
export function Splash({ message }: { message?: string }) {
  return (
    <div className="min-h-screen bg-brand-950 flex flex-col items-center justify-center gap-4 px-6">
      <div className="relative">
        <div className="absolute inset-0 rounded-3xl bg-brand-400/30 blur-xl animate-pulse" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-400 to-teal-600 flex items-center justify-center shadow-lg">
          <Wifi className="w-8 h-8 text-brand-950 stroke-[2.5]" />
        </div>
      </div>

      <div className="text-center">
        <p className="text-brand-100 font-extrabold tracking-tight">Telesom FTTH</p>
        <p className="text-brand-400/80 text-[11px] font-semibold mt-0.5">
          Fixed Broadband · Group F1
        </p>
      </div>

      <div className="flex items-center gap-1.5 mt-1" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="w-1.5 h-1.5 rounded-full bg-brand-400/70 animate-bounce"
            style={{ animationDelay: `${index * 120}ms`, animationDuration: '900ms' }}
          />
        ))}
      </div>

      <p className="text-brand-300/80 text-[11px] font-medium" role="status">
        {message ?? 'Soo dejinaya… / Loading…'}
      </p>
    </div>
  );
}
