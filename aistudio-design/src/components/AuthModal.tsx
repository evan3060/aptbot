import React, { useState, useEffect } from "react";
import { X, Lock, User, CheckCircle2, AlertCircle } from "lucide-react";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (username: string) => void;
}

export default function AuthModal({ isOpen, onClose, onLoginSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Reset form when modal opens/closes or mode changes
  useEffect(() => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess("");
  }, [isOpen, mode]);

  if (!isOpen) return null;

  // Retrieve users from localStorage
  const getUsers = () => {
    const usersJson = localStorage.getItem("workspace_registered_users");
    if (!usersJson) {
      // Seed with a default user
      const defaultUsers = [{ username: "admin", password: "123" }];
      localStorage.setItem("workspace_registered_users", JSON.stringify(defaultUsers));
      return defaultUsers;
    }
    try {
      return JSON.parse(usersJson);
    } catch {
      return [{ username: "admin", password: "123" }];
    }
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!username.trim()) {
      setError("请输入用户名");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    const users = getUsers();

    if (mode === "login") {
      // Find matching user
      const foundUser = users.find(
        (u: any) => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password
      );

      if (foundUser) {
        setSuccess("登录成功！正在进入工作区...");
        setTimeout(() => {
          onLoginSuccess(foundUser.username);
          onClose();
        }, 800);
      } else {
        setError("用户名或密码错误");
      }
    } else {
      // Registration Flow
      if (!confirmPassword) {
        setError("请再次输入密码以确认");
        return;
      }
      if (password !== confirmPassword) {
        setError("两次输入的密码不一致");
        return;
      }
      if (password.length < 3) {
        setError("密码长度不能少于 3 位");
        return;
      }

      // Check if username already exists
      const userExists = users.some(
        (u: any) => u.username.toLowerCase() === username.trim().toLowerCase()
      );

      if (userExists) {
        setError("用户名已被注册，请尝试其他用户名");
        return;
      }

      // Add new user
      const updatedUsers = [...users, { username: username.trim(), password }];
      localStorage.setItem("workspace_registered_users", JSON.stringify(updatedUsers));

      setSuccess("注册成功！即将返回登录...");
      setTimeout(() => {
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setSuccess("");
      }, 1200);
    }
  };

  const handleCancel = () => {
    if (mode === "register") {
      setMode("login");
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white border border-slate-200 shadow-2xl rounded-2xl w-full max-w-[390px] overflow-hidden flex flex-col relative">
        
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
            {mode === "login" ? "欢迎访问工作区" : "新用户注册"}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {mode === "login" 
              ? "登录以享受完整智能办公与代码分析服务" 
              : "注册一个新账号以同步您的会话与配置"}
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
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white transition-all text-black"
                required
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
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white transition-all text-black"
                required
              />
            </div>
          </div>

          {/* Confirm Password Input (Only for Register Mode) */}
          {mode === "register" && (
            <div className="space-y-1.5 animate-slide-down">
              <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">确认密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input 
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="请再次输入密码"
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-black focus:bg-white transition-all text-black"
                  required
                />
              </div>
            </div>
          )}

          {/* Buttons Area */}
          <div className="flex flex-col gap-2 pt-2">
            
            <div className="grid grid-cols-2 gap-2">
              {/* Cancel Button */}
              <button 
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-colors cursor-pointer select-none active:scale-[0.98]"
              >
                取消
              </button>

              {/* Confirm Button */}
              <button 
                type="submit"
                className="px-4 py-2 bg-black text-white hover:bg-neutral-800 font-bold text-xs rounded-lg transition-colors cursor-pointer select-none active:scale-[0.98]"
              >
                确认
              </button>
            </div>

            {/* Register Trigger button (only in Login mode) */}
            {mode === "login" && (
              <button 
                type="button"
                onClick={() => setMode("register")}
                className="w-full px-4 py-2 bg-white border border-slate-200 hover:border-slate-400 text-slate-700 font-bold text-xs rounded-lg transition-all cursor-pointer select-none active:scale-[0.98] mt-1"
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
