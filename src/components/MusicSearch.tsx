import React, { useEffect, useRef, useState } from "react";
import { Search, Play, Disc3, User } from "lucide-react";
import { search, playUri, type SearchResults } from "../lib/spotify";

type Props = {
  clientId: string;
  deviceId: string;
  notify: (msg: string, type?: string) => void;
  onPlayed?: () => void;
};

const empty: SearchResults = { tracks: [], artists: [], albums: [] };

/** Search Spotify and play results on the selected device. */
export default function MusicSearch({ clientId, deviceId, notify, onPlayed }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // Debounce so typing doesn't hammer the API.
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults(empty);
      setError("");
      return;
    }
    timer.current = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        setResults(await search(clientId, q));
      } catch (e: any) {
        setError(e?.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [query, clientId]);

  const play = async (uri: string, label: string) => {
    if (!deviceId) {
      notify("Pick a playback device first", "error");
      return;
    }
    setBusy(uri);
    try {
      await playUri(clientId, uri, deviceId);
      notify(`Playing ${label}`, "success");
      onPlayed?.();
    } catch (e: any) {
      notify(e?.message || "Couldn't play that", "error");
    } finally {
      setBusy(null);
    }
  };

  const hasResults =
    results.tracks.length + results.artists.length + results.albums.length > 0;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, artists, albums"
          aria-label="Search Spotify"
          className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 transition"
        />
      </div>

      {error && <p className="text-xs text-rose-300 mt-3">{error}</p>}
      {loading && <p className="text-xs text-slate-500 mt-3">Searching…</p>}

      {!loading && query.trim().length >= 2 && !hasResults && !error && (
        <p className="text-sm text-slate-500 mt-4">Nothing found for that.</p>
      )}

      {results.tracks.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Songs</h4>
          <div className="space-y-1">
            {results.tracks.map((t) => (
              <button
                key={t.id}
                onClick={() => play(t.uri, t.name)}
                disabled={busy !== null}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors text-left group"
              >
                {t.image ? (
                  <img src={t.image} alt="" className="w-9 h-9 rounded object-cover bg-slate-800" />
                ) : (
                  <div className="w-9 h-9 rounded bg-slate-800 flex items-center justify-center">
                    <Disc3 className="w-4 h-4 text-slate-600" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{t.name}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {t.artists} · {t.album}
                  </p>
                </div>
                <Play className="w-4 h-4 text-slate-500 group-hover:text-indigo-300 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {results.artists.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Artists</h4>
          <div className="flex flex-wrap gap-2">
            {results.artists.map((a) => (
              <button
                key={a.id}
                onClick={() => play(a.uri, a.name)}
                disabled={busy !== null}
                className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-slate-800/60 border border-slate-700 hover:border-indigo-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
              >
                {a.image ? (
                  <img src={a.image} alt="" className="w-6 h-6 rounded-full object-cover" />
                ) : (
                  <User className="w-4 h-4 text-slate-500" />
                )}
                <span className="text-sm">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {results.albums.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Albums</h4>
          <div className="flex flex-wrap gap-2">
            {results.albums.map((a) => (
              <button
                key={a.id}
                onClick={() => play(a.uri, a.name)}
                disabled={busy !== null}
                className="flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700 hover:border-indigo-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 transition-colors"
              >
                {a.image ? (
                  <img src={a.image} alt="" className="w-6 h-6 rounded object-cover" />
                ) : (
                  <Disc3 className="w-4 h-4 text-slate-500" />
                )}
                <span className="text-sm">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
