import React, { useEffect, useState } from 'react';
import { AlertEvent } from '../../types';
import { ShieldAlert, AlertTriangle, Info, X, ExternalLink } from 'lucide-react';
import { alertAudio } from '../../services/alertAudio';

interface AlertToastNotificationProps {
  latestAlert: AlertEvent | null;
  onOpenAlertCenter: () => void;
  onSelectSymbol?: (symbol: string) => void;
}

export const AlertToastNotification: React.FC<AlertToastNotificationProps> = ({
  latestAlert,
  onOpenAlertCenter,
  onSelectSymbol,
}) => {
  const [visibleAlert, setVisibleAlert] = useState<AlertEvent | null>(null);

  useEffect(() => {
    if (latestAlert) {
      setVisibleAlert(latestAlert);
      alertAudio.play(latestAlert.severity);

      const timer = setTimeout(() => {
        setVisibleAlert(null);
      }, 7000); // Auto-dismiss after 7 seconds

      return () => clearTimeout(timer);
    }
  }, [latestAlert]);

  if (!visibleAlert) return null;

  const isCritical = visibleAlert.severity === 'CRITICAL';
  const isWarning = visibleAlert.severity === 'WARNING';

  return (
    <div
      className={`fixed top-14 right-4 z-50 max-w-sm w-full rounded-xl border shadow-2xl p-4 transition-all duration-300 transform translate-y-0 backdrop-blur-md animate-in fade-in slide-in-from-top-2 ${
        isCritical
          ? 'bg-red-950/90 border-red-700 text-red-100 shadow-red-950/50'
          : isWarning
          ? 'bg-amber-950/90 border-amber-700 text-amber-100 shadow-amber-950/50'
          : 'bg-zinc-900/90 border-zinc-700 text-zinc-100 shadow-black/50'
      }`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded-lg shrink-0 ${
            isCritical
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : isWarning
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
          }`}
        >
          {isCritical ? <ShieldAlert size={18} /> : isWarning ? <AlertTriangle size={18} /> : <Info size={18} />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold text-xs uppercase px-1.5 py-0.5 rounded bg-black/40">
                {visibleAlert.symbol}
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider opacity-80">
                {visibleAlert.type.replace('_', ' ')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setVisibleAlert(null)}
              className="text-zinc-400 hover:text-white p-0.5 rounded"
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>

          <p className="text-xs mt-1.5 font-medium leading-relaxed line-clamp-2">
            {visibleAlert.message}
          </p>

          <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[11px]">
            <span className="font-mono opacity-60">
              {new Date(visibleAlert.timestamp).toLocaleTimeString()}
            </span>
            <div className="flex items-center gap-2">
              {onSelectSymbol && (
                <button
                  type="button"
                  onClick={() => {
                    onSelectSymbol(visibleAlert.symbol);
                    setVisibleAlert(null);
                  }}
                  className="hover:underline font-semibold text-amber-300"
                >
                  View Chart
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onOpenAlertCenter();
                  setVisibleAlert(null);
                }}
                className="font-semibold underline flex items-center gap-1"
              >
                Alerts <ExternalLink size={10} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
