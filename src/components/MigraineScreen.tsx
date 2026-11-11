import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Brain, Plus, Download, Trash2, RefreshCw, X, Wand2 } from "lucide-react";
import { motionTokens } from "../lib/design";
import HeadacheWizard from "./HeadacheWizard";
import type { Match } from "../lib/headache";

/**
 * Migraine diary.
 *
 * Episodes go to Babblebot's API so they survive a reinstall and can be
 * exported as a plain-text diary to hand to a GP. The head map is drawn as
 * regions rather than a photo so it stays legible at phone size and the
 * region names stay stable for the API.
 */

type Region = { id: string; label: string; d: string };

// Head drawn as a rounded shape split into tappable areas. Coordinates are on
// a 100x120 viewBox; each path is one region.
const REGIONS: Region[] = [
  { id: "forehead", label: "Forehead", d: "M50 6 C34 6 24 16 22 28 L78 28 C76 16 66 6 50 6 Z" },
  { id: "temple_left", label: "Left temple", d: "M22 30 L34 30 L34 44 L20 44 C19 39 20 34 22 30 Z" },
  { id: "temple_right", label: "Right temple", d: "M78 30 L66 30 L66 44 L80 44 C81 39 80 34 78 30 Z" },
  { id: "eye_left", label: "Around left eye", d: "M34 31 L48 31 L48 46 L34 46 Z" },
  { id: "eye_right", label: "Around right eye", d: "M52 31 L66 31 L66 46 L52 46 Z" },
  { id: "vertex", label: "Top of head", d: "M24 29 L76 29 C76 20 66 9 50 9 C34 9 24 20 24 29 Z" },
  { id: "behind_left", label: "Behind left eye", d: "M34 48 L48 48 L48 58 L34 58 Z" },
  { id: "behind_right", label: "Behind right eye", d: "M52 48 L66 48 L66 58 L52 58 Z" },
  { id: "occipital_left", label: "Back left", d: "M22 46 L34 46 L34 62 L23 62 C21 56 21 51 22 46 Z" },
  { id: "occipital_right", label: "Back right", d: "M66 46 L78 46 C79 51 79 56 77 62 L66 62 Z" },
  { id: "neck", label: "Neck", d: "M36 66 L64 66 L60 84 L40 84 Z" },
  { id: "jaw_left", label: "Left jaw", d: "M30 62 L38 62 L40 78 L31 74 C29 70 29 66 30 62 Z" },
  { id: "jaw_right", label: "Right jaw", d: "M62 62 L70 62 C71 66 71 70 69 74 L60 78 Z" },
];

const TYPES = [
  "Migraine with aura",
  "Migraine without aura",
  "Silent / aura only",
  "Cluster",
  "Tension-type",
  "Not sure",
];

const SYMPTOMS = [
  "Nausea",
  "Vomiting",
  "Light sensitivity",
  "Sound sensitivity",
  "Smell sensitivity",
  "Dizziness",
  "Visual disturbance",
  "Neck stiffness",
];

const TRIGGERS = [
  "Poor sleep",
  "Stress",
  "Screen time",
  "Dehydration",
  "Missed meal",
  "Weather",
  "Caffeine",
  "Hormonal",
  "Unknown",
];

type Entry = {
  id: string;
  started: string;
  ended?: string | null;
  severity?: number | null;
  type?: string | null;
  regions?: string[];
  symptoms?: string[];
  triggers?: string[];
  medications?: string | null;
  notes?: string | null;
};

type Summary = { avg_hours: number | null; avg_severity: number | null; regions: Record<string, number> };

type Props = { apiUrl: string };

const severityColour = (n: number) => {
  if (n <= 3) return "text-emerald-300";
  if (n <= 6) return "text-amber-300";
  if (n <= 8) return "text-orange-300";
  return "text-rose-300";
};

const severityBg = (n: number) => {
  if (n <= 3) return "bg-emerald-500/15 border-emerald-500/40 text-emerald-200";
  if (n <= 6) return "bg-amber-500/15 border-amber-500/40 text-amber-200";
  if (n <= 8) return "bg-orange-500/15 border-orange-500/40 text-orange-200";
  return "bg-rose-500/15 border-rose-500/40 text-rose-200";
};

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function MigraineScreen({ apiUrl }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [saving, setSaving] = useState(false);

  // form state
  const [started, setStarted] = useState(localNow());
  const [ended, setEnded] = useState("");
  const [severity, setSeverity] = useState(5);
  const [type, setType] = useState(TYPES[0]);
  const [regions, setRegions] = useState<string[]>([]);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [medications, setMedications] = useState("");
  const [notes, setNotes] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [generalNotes, setGeneralNotes] = useState<string>("");
  const [notesSaved, setNotesSaved] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl + "/api/migraines");
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      setEntries(Array.isArray(data.migraines) ? data.migraines : []);
      setSummary(data.summary || null);
      setError("");
      try {
        const nres = await fetch(apiUrl + "/api/migraines/notes");
        if (nres.ok) {
          const nd = await nres.json();
          setGeneralNotes(nd.notes || "");
          setNotesSaved(true);
        }
      } catch {}
    } catch {
      setError("Couldn't reach the bot API — is the Windows machine awake?");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (list: string[], setList: (v: string[]) => void, value: string) =>
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const resetForm = () => {
    setStarted(localNow());
    setEnded("");
    setSeverity(5);
    setType(TYPES[0]);
    setRegions([]);
    setSymptoms([]);
    setTriggers([]);
    setMedications("");
    setNotes("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl + "/api/migraines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          started: new Date(started).toISOString(),
          ended: ended ? new Date(ended).toISOString() : null,
          severity,
          type,
          regions,
          symptoms,
          triggers,
          medications,
          notes,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      resetForm();
      setAdding(false);
      await load();
    } catch {
      setError("Couldn't save that episode — check the bot is running.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await fetch(apiUrl + "/api/migraines/" + id, { method: "DELETE" });
      await load();
    } catch {
      setError("Couldn't delete that entry.");
    }
  };

  const openExport = () => {
    const a = document.createElement("a");
    a.href = apiUrl + "/api/migraines/export";
    a.download = "migraine-diary.txt";
    a.click();
  };

  const acceptWizard = (m: Match | null, sev: number) => {
    setSeverity(sev);
    if (m) {
      // Map the wizard's label onto the closest type chip so the log stays
      // consistent with what the user could have picked by hand.
      const map: Record<string, string> = {
        migraine_without_aura: "Migraine without aura",
        migraine_with_aura: "Migraine with aura",
        tension_type: "Tension-type",
        cluster: "Cluster",
      };
      if (map[m.id]) setType(map[m.id]);
      if (m.id === "tension_type" || m.id === "migraine_without_aura") {
        // Seed the head map from the pain pattern they described.
        setRegions((r) => (r.length ? r : m.id === "tension_type" ? ["forehead", "vertex"] : ["temple_left"]));
      }
      if (m.id === "tension_type") setSymptoms((s) => (s.includes("Neck stiffness") ? s : [...s, "Neck stiffness"]));
    }
    setNotes((n) => n || "Type suggested by the guided questions");
    setWizard(false);
    setAdding(true);
  };

  const regionLabel = useMemo(() => {
    const map: Record<string, string> = {};
    REGIONS.forEach((r) => (map[r.id] = r.label));
    return map;
  }, []);

  const chip = (active: boolean) =>
    "px-3 py-1.5 rounded-full text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 " +
    (active
      ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-200"
      : "bg-slate-800/40 border-slate-700 text-slate-400 hover:bg-slate-700/50");

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionTokens.enter}
      className="space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Migraine diary</h2>
          <p className="text-sm text-slate-400 mt-1">
            Track episodes and export them for your GP.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
            aria-label="Export diary"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={load}
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
            aria-label="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWizard(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-indigo-500/40 text-sm text-indigo-200 hover:bg-indigo-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
            title="Not sure what kind it is?"
          >
            <Wand2 className="w-4 h-4" /> Not sure?
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 text-sm font-medium hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
          >
            <Plus className="w-4 h-4" /> Log episode
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-4 bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Summary strip */}
      {summary && entries.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-slate-500">Episodes</p>
            <p className="text-2xl font-bold tabular-nums text-indigo-300">{entries.length}</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-slate-500">Avg length</p>
            <p className="text-2xl font-bold tabular-nums text-purple-300">
              {summary.avg_hours != null ? `${summary.avg_hours}h` : "—"}
            </p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs text-slate-500">Avg severity</p>
            <p
              className={
                "text-2xl font-bold tabular-nums " +
                (summary.avg_severity != null ? severityColour(summary.avg_severity) : "text-slate-500")
              }
            >
              {summary.avg_severity != null ? summary.avg_severity : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Entry form */}
      {adding && (
        <div className="glass rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">New episode</h3>
            <button
              onClick={() => setAdding(false)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Head map */}
          <div>
            <p className="text-xs text-slate-500 mb-2">
              Tap where it hurts {regions.length > 0 && `· ${regions.length} selected`}
            </p>
            <div className="flex gap-4 items-start">
              <svg viewBox="0 0 100 90" className="w-40 h-36 shrink-0">
                {REGIONS.map((r) => {
                  const on = regions.includes(r.id);
                  return (
                    <path
                      key={r.id}
                      d={r.d}
                      onClick={() => toggle(regions, setRegions, r.id)}
                      onMouseEnter={() => setHovered(r.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={
                        "cursor-pointer transition-colors stroke-slate-900/60 " +
                        (on
                          ? "fill-rose-500/70"
                          : hovered === r.id
                          ? "fill-indigo-400/40"
                          : "fill-slate-700/60 hover:fill-indigo-400/30")
                      }
                      strokeWidth="0.8"
                    />
                  );
                })}
              </svg>
              <div className="flex-1 min-h-8">
                {regions.length === 0 ? (
                  <p className="text-xs text-slate-600">
                    No areas selected yet — tap the head diagram.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {regions.map((id) => (
                      <button
                        key={id}
                        onClick={() => toggle(regions, setRegions, id)}
                        className="px-2 py-1 rounded-full text-xs bg-rose-500/20 border border-rose-500/40 text-rose-200 hover:bg-rose-500/30"
                      >
                        {regionLabel[id] || id} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Severity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-slate-500">Severity</p>
              <span className={"text-sm font-semibold " + severityColour(severity)}>{severity}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={severity}
              onChange={(e) => setSeverity(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500">Started</span>
              <input
                type="datetime-local"
                value={started}
                onChange={(e) => setStarted(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500">Ended (optional)</span>
              <input
                type="datetime-local"
                value={ended}
                onChange={(e) => setEnded(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
              />
            </label>
          </div>

          {/* Type */}
          <div>
            <p className="text-xs text-slate-500 mb-2">Type</p>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map((t) => (
                <button key={t} onClick={() => setType(t)} className={chip(type === t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Symptoms */}
          <div>
            <p className="text-xs text-slate-500 mb-2">Symptoms</p>
            <div className="flex flex-wrap gap-1.5">
              {SYMPTOMS.map((s) => (
                <button key={s} onClick={() => toggle(symptoms, setSymptoms, s)} className={chip(symptoms.includes(s))}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Triggers */}
          <div>
            <p className="text-xs text-slate-500 mb-2">Possible triggers</p>
            <div className="flex flex-wrap gap-1.5">
              {TRIGGERS.map((t) => (
                <button key={t} onClick={() => toggle(triggers, setTriggers, t)} className={chip(triggers.includes(t))}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-slate-500">Medication taken</span>
            <input
              value={medications}
              onChange={(e) => setMedications(e.target.value)}
              placeholder="e.g. paracetamol 1g at onset"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500"
            />
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything about this episode worth telling your GP"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-none"
            />
          </label>

          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-600 font-semibold hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
          >
            {saving ? "Saving…" : "Save episode"}
          </button>
        </div>
      )}

      {/* Notes for the doctor */}
      <div className="glass rounded-2xl p-5 space-y-3">
        <div>
          <p className="text-sm font-medium">Notes for your doctor</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Anything you want to remember to mention — saved with your diary and
            included in the export. Not tied to one episode.
          </p>
        </div>
        <textarea
          value={generalNotes}
          onChange={(e) => {
            setGeneralNotes(e.target.value);
            setNotesSaved(false);
          }}
          rows={4}
          placeholder="e.g. headaches started after starting a new medication; worse in the week before my period; family history of migraine"
          className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-sm focus:outline-none focus:border-indigo-500 resize-y"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-600">
            {notesSaved ? "Saved" : "Unsaved changes"}
          </span>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                setGeneralNotes("");
                try {
                  await fetch(apiUrl + "/api/migraines/notes", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ notes: "" }),
                  });
                  setNotesSaved(true);
                } catch {}
              }}
              className="px-3 py-1.5 rounded-lg text-xs bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-rose-300 hover:bg-rose-500/10"
            >
              Clear
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await fetch(apiUrl + "/api/migraines/notes", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ notes: generalNotes }),
                  });
                  if (!r.ok) throw new Error("failed");
                  setNotesSaved(true);
                } catch {
                  setError("Couldn't save your notes — check the bot is running.");
                }
              }}
              className="px-3 py-1.5 rounded-lg text-xs bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 hover:bg-indigo-500/30"
            >
              Save notes
            </button>
          </div>
        </div>
      </div>

      {/* History */}
      {loading && !error && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && entries.length === 0 && !error && (
        <div className="glass rounded-2xl p-8 text-center">
          <Brain className="w-8 h-8 text-indigo-400/60 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No episodes logged yet.</p>
          <p className="text-xs text-slate-600 mt-1">
            Logging a few gives your GP something concrete to work from.
          </p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((e) => {
            const sev = typeof e.severity === "number" ? e.severity : null;
            return (
              <div key={e.id} className="glass rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {new Date(e.started).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {sev != null && (
                        <span className={"px-2 py-0.5 rounded-full text-xs border " + severityBg(sev)}>
                          {sev}/10
                        </span>
                      )}
                      {e.type && <span className="text-xs text-slate-500">{e.type}</span>}
                    </div>
                    {e.regions && e.regions.length > 0 && (
                      <p className="text-xs text-rose-300/80 mt-1">
                        {e.regions.map((r) => regionLabel[r] || r).join(" · ")}
                      </p>
                    )}
                    {(e.symptoms?.length || e.triggers?.length) && (
                      <p className="text-xs text-slate-500 mt-1">
                        {[...(e.symptoms || []), ...(e.triggers || [])].join(", ")}
                      </p>
                    )}
                    {e.notes && <p className="text-xs text-slate-400 mt-1 italic">{e.notes}</p>}
                  </div>
                  <button
                    onClick={() => remove(e.id)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-300 hover:bg-rose-500/10 shrink-0"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {wizard && <HeadacheWizard onAccept={acceptWizard} onClose={() => setWizard(false)} />}
    </motion.section>
  );
}
