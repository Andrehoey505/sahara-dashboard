import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Lock, Sparkles } from "lucide-react";
import { motionTokens } from "../lib/design";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  error?: boolean;
};

/**
 * PIN lock, shown on every launch. The PIN is set the first time and stored
 * locally; the Discord user ID is what links the app to a person across
 * sessions, so this is a quick gate rather than an account login.
 */
export default function LockScreen({ value, onChange, onSubmit, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionTokens.enter}
        className="w-full max-w-sm"
      >
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Sahara</h1>
            <p className="text-sm text-slate-400">Control Center</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="glass rounded-2xl p-6"
        >
          <label
            htmlFor="pin"
            className="flex items-center justify-center gap-2 text-sm text-slate-300 mb-4"
          >
            <Lock className="w-4 h-4" /> Enter your PIN
          </label>
          <input
            id="pin"
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="••••"
            aria-invalid={!!error}
            aria-describedby={error ? "pin-error" : undefined}
            className={
              "w-full px-4 py-3 rounded-lg bg-slate-800/60 border text-center text-2xl tracking-[0.5em] focus:outline-none focus-visible:ring-2 transition " +
              (error
                ? "border-rose-500/60 focus:border-rose-500 focus-visible:ring-rose-500/40"
                : "border-slate-700 focus:border-indigo-500 focus-visible:ring-indigo-500/40")
            }
          />
          {error && (
            <p id="pin-error" className="text-sm text-rose-300 text-center mt-3" role="alert">
              That PIN doesn&apos;t match
            </p>
          )}
          <button
            type="submit"
            className="w-full mt-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 font-semibold hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 transition"
          >
            Unlock
          </button>
        </form>
      </motion.div>
    </div>
  );
}
