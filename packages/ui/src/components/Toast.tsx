import { useState, type MouseEvent } from "react";
import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number | null;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (
    message: string,
    type?: ToastType,
    options?: ToastOptions,
  ) => string;
  updateToast: (
    id: string,
    message: string,
    type?: ToastType,
    durationMs?: number | null,
  ) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type = "info", options) => {
    const id = Math.random().toString(36).slice(2);
    const { durationMs = 4000, ...toastOptions } = options ?? {};
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, ...toastOptions }],
    }));
    if (durationMs !== null) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, durationMs);
    }
    return id;
  },
  updateToast: (id, message, type, durationMs = null) => {
    set((state) => ({
      toasts: state.toasts.map((toast) =>
        toast.id === id
          ? { ...toast, message, type: type ?? toast.type }
          : toast,
      ),
    }));
    if (durationMs !== null) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((toast) => toast.id !== id),
        }));
      }, durationMs);
    }
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

export const toast = {
  success: (
    message: string,
    options?: ToastOptions,
  ) => useToastStore.getState().addToast(message, "success", options),
  error: (
    message: string,
    options?: ToastOptions,
  ) => useToastStore.getState().addToast(message, "error", options),
  info: (
    message: string,
    options?: ToastOptions,
  ) => useToastStore.getState().addToast(message, "info", options),
  update: (
    id: string,
    message: string,
    type?: ToastType,
    durationMs?: number | null,
  ) => useToastStore.getState().updateToast(id, message, type, durationMs),
  dismiss: (id: string) => useToastStore.getState().removeToast(id),
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(onClose, 200);
  };

  const handleAction = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toast.onAction?.();
    handleClose();
  };

  const bgColor = {
    success:
      "bg-[var(--theme-bg-elevated)] ring-1 ring-[rgb(var(--theme-feedback-success-rgb)/0.3)] border-[rgb(var(--theme-feedback-success-rgb)/0.3)]",
    error:
      "bg-[var(--theme-bg-elevated)] ring-1 ring-[rgb(var(--theme-feedback-danger-rgb)/0.3)] border-[rgb(var(--theme-feedback-danger-rgb)/0.3)]",
    info: "bg-[var(--theme-bg-elevated)] ring-1 ring-[color:color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)] border-[color:color-mix(in_srgb,var(--theme-accent-secondary)_30%,transparent)]",
  }[toast.type];

  const textColor = {
    success: "text-[rgb(var(--theme-feedback-success-rgb))]",
    error: "text-[rgb(var(--theme-feedback-danger-rgb))]",
    info: "text-[var(--theme-accent-secondary)]",
  }[toast.type];

  const icon = {
    success: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }[toast.type];

  return (
    <div
      aria-live={toast.type === "error" ? "assertive" : "polite"}
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl border
        ${bgColor}
        ${isExiting ? "animate-slide-out" : "animate-slide-in"}
      `}
      onClick={handleClose}
      role={toast.type === "error" ? "alert" : "status"}
    >
      <span className={textColor}>{icon}</span>
      <span className="flex-1 text-sm text-text-primary">{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          onClick={handleAction}
          className={`text-xs font-medium transition-colors ${textColor} hover:text-text-primary`}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        onClick={(event) => {
          event.stopPropagation();
          handleClose();
        }}
        className="text-text-muted hover:text-text-primary transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 sm:bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-[400] space-y-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
      ))}
    </div>
  );
}
