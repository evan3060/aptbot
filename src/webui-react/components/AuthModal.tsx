/**
 * Task 2 (React WebUI redesign): 认证弹窗组件。
 *
 * 迁移自 aistudio-design/src/components/AuthModal.tsx，保留极简黑白灰视觉风格、
 * 登录/注册双模式、错误/成功 toast 提示。
 *
 * 关键变更：将原 localStorage getUsers 逻辑替换为 AuthController.login / register 调用，
 * 通过后端 /api/login /api/register 端点进行真实认证。
 */
import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, User, CheckCircle2, AlertCircle } from 'lucide-react';
import { authController } from '../lib/auth.js';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (username: string) => void;
}

export default function AuthModal({ isOpen, onClose, onLoginSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset form when modal opens/closes or mode changes; clear any pending success timer
  useEffect(() => {
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setLoading(false);
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, [isOpen, mode]);

  if (!isOpen) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!username.trim()) {
      setError('请输入用户名');
      return;
    }
    if (!password) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    let didSucceed = false;

    try {
      if (mode === 'login') {
        const user = await authController.login(username.trim(), password);
        setSuccess('登录成功！正在进入工作区...');
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          onLoginSuccess(user.username);
          onClose();
        }, 800);
        didSucceed = true;
      } else {
        // Registration Flow
        if (!confirmPassword) {
          setError('请再次输入密码以确认');
          return;
        }
        if (password !== confirmPassword) {
          setError('两次输入的密码不一致');
          return;
        }
        if (password.length < 3) {
          setError('密码长度不能少于 3 位');
          return;
        }

        await authController.register(username.trim(), password);
        setSuccess('注册成功！即将返回登录...');
        successTimerRef.current = setTimeout(() => {
          successTimerRef.current = null;
          setMode('login');
          setPassword('');
          setConfirmPassword('');
          setSuccess('');
        }, 1200);
        didSucceed = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '请求失败';
      if (mode === 'login') {
        setError('用户名或密码错误');
      } else if (message.includes('already exists')) {
        setError('用户名已被注册，请尝试其他用户名');
      } else {
        setError(message);
      }
    } finally {
      // Keep loading true through the success-delay window so the buttons stay
      // disabled until the modal closes (login) or mode switches (register).
      if (!didSucceed) {
        setLoading(false);
      }
    }
  };

  const handleCancel = () => {
    if (mode === 'register') {
      setMode('login');
    } else {
      onClose();
    }
  };

  return (
    <div
      data-testid="auth-modal"
      data-mode={mode}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-0 md:p-4 animate-fade-in"
    >
      <div className="bg-white border border-slate-200 shadow-2xl rounded-none md:rounded-2xl w-full max-w-full md:max-w-[390px] h-full md:h-auto overflow-hidden flex flex-col fixed md:relative inset-0 md:inset-auto">

        {/* Close Button on Top Right */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-black transition-colors rounded-full p-1 hover:bg-slate-100 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Header */}
        <div className="px-6 pt-8 pb-4 text-center">
          <div className="w-12 h-12 bg-slate-50 border border-slate-200 rounded-full flex items-center justify-center mx-auto mb-3 shadow-2xs">
            <User className="w-6 h-6 text-neutral-700" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">
            {mode === 'login' ? '欢迎访问工作区' : '新用户注册'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {mode === 'login'
              ? '登录以享受完整智能办公与代码分析服务'
              : '注册一个新账号以同步您的会话与配置'}
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleConfirm} className="px-6 pb-6 space-y-4">

          {error && (
            <div className="flex items-center gap-2 p-2.5 bg-rose-50 text-rose-700 text-xs rounded-lg border border-rose-100">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-2.5 bg-emerald-50 text-emerald-700 text-xs rounded-lg border border-emerald-100">
              <CheckCircle2 className="w-4 h-4 shrink-0 animate-bounce" />
              <span>{success}</span>
            </div>
          )}

          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">用户名</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white transition-all text-black"
                required
                data-testid="auth-username"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white transition-all text-black"
                required
                data-testid="auth-password"
              />
            </div>
          </div>

          {/* Confirm Password Input (Only for Register Mode) */}
          {mode === 'register' && (
            <div className="space-y-1.5 animate-slide-down">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">确认密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white transition-all text-black"
                  required
                  data-testid="auth-confirm-password"
                />
              </div>
            </div>
          )}

          {/* Buttons Area */}
          <div className="flex flex-col gap-2 pt-2">

            <div className="flex flex-col md:grid md:grid-cols-2 gap-2">
              {/* Cancel Button */}
              <button
                type="button"
                onClick={handleCancel}
                disabled={loading}
                className="w-full px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors cursor-pointer select-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="auth-cancel"
              >
                取消
              </button>

              {/* Confirm Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2 bg-black text-white hover:bg-neutral-800 font-bold text-xs rounded-lg transition-colors cursor-pointer select-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="auth-confirm"
              >
                确认
              </button>
            </div>

            {/* Register Trigger button (only in Login mode) */}
            {mode === 'login' && (
              <button
                type="button"
                onClick={() => setMode('register')}
                disabled={loading}
                className="w-full px-4 py-2 bg-white border border-slate-200 hover:border-slate-400 text-slate-700 font-bold text-xs rounded-lg transition-all cursor-pointer select-none active:scale-[0.98] mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="auth-register-trigger"
              >
                没有账号？注册账号
              </button>
            )}

          </div>

        </form>
      </div>
    </div>
  );
}
