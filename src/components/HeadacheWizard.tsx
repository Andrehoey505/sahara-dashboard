import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft, HelpCircle, AlertTriangle, Check } from "lucide-react";
import { motionTokens } from "../lib/design";
import { QUESTIONS, classify, severityBand, type Answers, type Match } from "../lib/headache";

/**
 * Guided "help me work out what this is" flow.
 *
 * Used when someone doesn't recognise their own headache. It walks the ICHD-3
 * style questions one at a time, shows a plain-language rewording of each, and
 * ends on ranked possibilities plus any red flags.
 *
 * The result is explicitly a guide, and the parent screen is responsible for
 * carrying whatever the person accepts into the episode form — nothing here
 * saves on its own.
 */

type Props = {
  onAccept: (m: Match | null, severity: number) => void;
  onClose: () => void;
};

export default function HeadacheWizard({ onAccept, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [plain, setPlain] = useState(false);
  const [severity, setSeverity] = useState(5);
  const [done, setDone] = useState(false);

  const q = QUESTIONS[step];
  const total = QUESTIONS.length;
  const result = done ? classify(answers) : null;

  const answer = (value: boolean | number) => {
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    if (step + 1 >= total) setDone(true);
    else setStep(step + 1);
  };

  const back = () => {
    if (done) {
      setDone(false);
      setStep(total - 1);
    } else if (step > 0) setStep(step - 1);
  };

  const progress = done ? 100 : Math.round((step / total) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={motionTokens.enter}
        className="w-full max-w-lg glass rounded-2xl p-6 max-h-[85vh] overflow-y-auto"
      >
        {/* Progress */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 tabular-nums shrink-0">
            {done ? "Done" : `${step + 1}/${total}`}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {!done ? (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={motionTokens.base}
              className="space-y-5"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-medium leading-snug">{q.text}</h3>
                  {q.plain && (
                    <button
                      onClick={() => setPlain((v) => !v)}
                      className={
                        "p-1.5 rounded-lg shrink-0 " +
                        (plain ? "text-indigo-300 bg-indigo-500/15" : "text-slate-500 hover:text-slate-300")
                      }
                      aria-label="Explain in plain words"
                      title="Explain in plain words"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {plain && q.plain && (
                  <p className="text-sm text-indigo-200/80 mt-2 italic">{q.plain}</p>
                )}
                {q.hint && <p className="text-xs text-slate-500 mt-2">{q.hint}</p>}
              </div>

              {q.kind === "bool" ? (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => answer(true)}
                    className="py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 font-medium hover:bg-emerald-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => answer(false)}
                    className="py-3 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-300 font-medium hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/60"
                  >
                    No
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="range"
                    min={0}
                    max={q.id === "duration_hours" ? 72 : 30}
                    value={typeof answers[q.id] === "number" ? (answers[q.id] as number) : 0}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: Number(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                  <p className="text-center text-lg font-semibold tabular-nums text-indigo-300">
                    {typeof answers[q.id] === "number" ? (answers[q.id] as number) : 0}
                    {q.id === "duration_hours" ? " hours" : " days"}
                  </p>
                  <button
                    onClick={() => answer(typeof answers[q.id] === "number" ? (answers[q.id] as number) : 0)}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90"
                  >
                    Next
                  </button>
                </div>
              )}

              <div className="flex justify-between pt-1">
                <button
                  onClick={back}
                  disabled={step === 0}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 disabled:opacity-30"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </button>
                <button
                  onClick={onClose}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={motionTokens.enter}
              className="space-y-4"
            >
              <h3 className="text-base font-medium">What your answers point to</h3>

              {result && result.flags.length > 0 && (
                <div className="rounded-xl p-3 bg-rose-500/10 border border-rose-500/40">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-300 mt-0.5 shrink-0" />
                    <div className="text-xs text-rose-200 space-y-1">
                      {result.flags.map((f) => (
                        <p key={f.id}>
                          {f.urgent
                            ? "Get medical help now — "
                            : "Worth getting checked — "}
                          {f.text.toLowerCase()}.
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {result?.matches.slice(0, 3).map((m) => (
                <div key={m.id} className="rounded-xl p-4 bg-slate-800/40 border border-slate-700">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">{m.label}</p>
                    <span
                      className={
                        "text-xs px-2 py-0.5 rounded-full border " +
                        (m.confidence === "strong"
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                          : m.confidence === "possible"
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                          : "bg-slate-700/40 border-slate-600 text-slate-400")
                      }
                    >
                      {m.confidence}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5">{m.about}</p>
                  <ul className="mt-2 space-y-0.5">
                    {m.because.map((b, i) => (
                      <li key={i} className="text-xs text-slate-500 flex items-start gap-1.5">
                        <Check className="w-3 h-3 mt-0.5 shrink-0 text-indigo-400" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-500">How bad is it right now?</span>
                  <span className="text-sm font-semibold text-indigo-300">{severity}/10</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={severity}
                  onChange={(e) => setSeverity(Number(e.target.value))}
                  className="w-full accent-indigo-500"
                />
                <p className="text-xs text-slate-400 mt-1">{severityBand(severity).advice}</p>
              </div>

              <p className="text-xs text-slate-600 italic">
                This is a guide based on your answers, not a diagnosis. Only a GP can
                diagnose a headache disorder.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={back}
                  className="flex items-center gap-1 px-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-300 hover:bg-slate-700/60"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={() => onAccept(result?.matches[0] ?? null, severity)}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90"
                >
                  Use this in my log
                </button>
              </div>
              <button
                onClick={() => onAccept(null, severity)}
                className="w-full text-xs text-slate-500 hover:text-slate-300 flex items-center justify-center gap-1"
              >
                Skip and log it myself <ChevronRight className="w-3 h-3" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
