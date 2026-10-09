import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Eye, EyeOff, Lock, Sparkles, User } from 'lucide-react';
import { PlanSummary } from '../../services/api';

export interface AuthPanelProps {
  authRequired: boolean;
  devMode: boolean;
  registrationEnabled: boolean;
  billingConfigured: boolean;
  plans: PlanSummary[];
  onAuthenticate: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
  onStartCheckout?: (planId: string) => Promise<void>;
  initialError?: string | null;
}

type Mode = 'login' | 'register';

/** Login / registration screen plus the plan catalog (shown when the server requires auth). */
export const AuthPanel: React.FC<AuthPanelProps> = ({
  authRequired,
  devMode,
  registrationEnabled,
  billingConfigured,
  plans,
  onAuthenticate,
  onRegister,
  onStartCheckout,
  initialError,
}) => {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const usernameRef = useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const passwordTooShort = mode === 'register' && password.length > 0 && password.length < 10;
  const canSubmit = !busy && password.length > 0 && (username.trim().length > 0 || (!authRequired && devMode));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await onRegister(username.trim(), password);
      } else {
        await onAuthenticate(username.trim() || 'guest', password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const paidPlans = plans.filter((plan) => plan.priceUsdMonthly > 0);

  return (
    <div
      className="min-h-screen text-[#E7EDF3] flex items-center justify-center p-5"
      style={{ background: 'radial-gradient(1000px 480px at 12% -10%, rgba(34,211,238,0.10), transparent), #080B0F' }}
    >
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-6">
        <div className="rounded-[10px] border border-[#1C2630] bg-[#0D1218] p-6" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div className="flex items-center gap-2">
            <span className="brand-icon">D</span>
            <h1 className="text-base font-bold tracking-tight">
              Deep<span style={{ color: 'var(--accent)' }}>Chart</span>
            </h1>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-[#94A3B8]">
            {authRequired
              ? 'Đăng nhập để mở terminal order-flow với đúng quyền của gói bạn sở hữu.'
              : 'Server này cho phép khách xem — để trống tên đăng nhập là vào chế độ guest.'}
          </p>
          <div className="mt-4 flex items-center gap-1 p-1 rounded-md border border-[#1C2630] bg-[#0B0F14]">
            {(['login', 'register'] as Mode[]).map((item) => (
              <button
                key={item}
                type="button"
                disabled={item === 'register' && !registrationEnabled}
                onClick={() => {
                  setMode(item);
                  setError(null);
                }}
                className={`flex-1 h-8 rounded text-[12px] font-semibold transition-colors ${
                  mode === item ? 'bg-[#1C2630] text-[#E7EDF3]' : 'text-[#7F8B97] hover:text-[#E7EDF3]'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {item === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-[11px] font-medium text-[#94A3B8]">Username</span>
              <span className="mt-1.5 flex items-center gap-2 rounded-md border border-[#1C2630] bg-[#0B0F14] px-3 focus-within:border-[#22D3EE]/60">
                <User size={13} className="text-[#4E5965]" />
                <input
                  ref={usernameRef}
                  className="flex-1 h-10 bg-transparent text-[13px] outline-none placeholder:text-[#4E5965]"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder={authRequired ? 'your-username' : 'guest'}
                />
              </span>
            </label>

            <label className="block">
              <span className="text-[11px] font-medium text-[#94A3B8]">Password</span>
              <span className="mt-1.5 flex items-center gap-2 rounded-md border border-[#1C2630] bg-[#0B0F14] px-3 focus-within:border-[#22D3EE]/60">
                <Lock size={13} className="text-[#4E5965]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="flex-1 h-10 bg-transparent text-[13px] outline-none placeholder:text-[#4E5965]"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'register' ? 'ít nhất 10 ký tự' : '••••••••'}
                  aria-invalid={passwordTooShort}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="text-[#4E5965] hover:text-[#E7EDF3]"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </span>
              {passwordTooShort && (
                <span className="mt-1 block text-[11px]" style={{ color: 'var(--warn)' }}>
                  Mật khẩu cần tối thiểu 10 ký tự.
                </span>
              )}
            </label>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md px-3 py-2 text-[12px]"
                style={{ background: 'var(--danger-soft)', border: '1px solid rgba(240,82,82,.35)', color: '#FCA5A5' }}
              >
                <AlertTriangle size={13} className="mt-[1px] shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-md font-semibold text-[13px] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)', color: '#04121A' }}
            >
              {busy ? 'Đang xử lý…' : mode === 'register' ? 'Tạo tài khoản' : 'Đăng nhập'}
              {!busy && <ArrowRight size={14} />}
            </button>
          </form>

          {devMode && (
            <p className="mt-4 text-[11px] text-[#64748B]">
              This server runs in development mode: an empty username signs you in as `guest`.
            </p>
          )}
        </div>

        <div className="rounded-[10px] border border-[#1C2630] bg-[#0D1218] p-6" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <div className="flex items-center gap-2">
            <Sparkles size={13} style={{ color: 'var(--accent)' }} />
            <h2 className="text-[13px] font-semibold">Gói & quyền truy cập</h2>
          </div>
          <p className="mt-2 text-[11.5px] text-[#7F8B97]">
            Quyền được server cấp theo gói — client không thể tự mở rộng. Nâng cấp qua Stripe hoặc nhờ operator cấp thủ công.
          </p>
          <div className="mt-4 space-y-3">
            {plans.map((plan) => {
              const recommended = plan.id === 'pro';
              return (
              <div
                key={plan.id}
                className="rounded-md border p-3"
                style={{
                  borderColor: recommended ? 'rgba(34,211,238,.35)' : 'var(--border-subtle)',
                  background: recommended ? 'rgba(34,211,238,.05)' : 'var(--bg-tertiary)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {plan.name}
                    {recommended && (
                      <span className="ml-2 dc-chip" data-tone="accent">
                        Phổ biến
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-[#22D3EE]">
                    {plan.priceUsdMonthly === 0 ? 'Free' : `$${plan.priceUsdMonthly}/mo`}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="text-[11px] text-[#94A3B8]">
                      • {feature}
                    </li>
                  ))}
                </ul>
                {plan.priceUsdMonthly > 0 && billingConfigured && onStartCheckout && (
                  <button
                    type="button"
                    onClick={() => void onStartCheckout(plan.id)}
                    className="mt-3 w-full h-8 rounded border text-[11px] font-semibold transition-colors hover:bg-[#22D3EE]/10"
                    style={{ borderColor: 'rgba(34,211,238,.45)', color: 'var(--accent)' }}
                  >
                    Đăng ký qua Stripe
                  </button>
                )}
              </div>
              );
            })}
          </div>
          {paidPlans.length > 0 && !billingConfigured && (
            <p className="mt-4 text-[11px] text-[#64748B]">
              Deployment này chưa cấu hình thanh toán — liên hệ operator để được cấp gói thủ công.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
