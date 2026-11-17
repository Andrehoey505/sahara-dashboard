import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Film, Music, FileText, Download, X, ImageOff } from "lucide-react";

/**
 * The attachments and embeds of one Discord message, shown underneath the text.
 *
 * Shape it expects, from GET /api/messages:
 *
 *   attachments: [{ url, proxy_url, filename, content_type, size, width, height, spoiler }]
 *   embeds:      [{ type, url, title, description, image, thumbnail, video, provider }]
 *
 * `proxy_url` is the bot's own /api/media?url=… route, and is what we actually load:
 * Discord's CDN links carry an expiring signature, so a feed that polls every few
 * seconds would start showing broken images as soon as a link aged out. The bot's
 * route re-signs on each request, so what is on screen is always current.
 *
 * A message with no attachments renders nothing at all — an empty strip would add a
 * gap to every ordinary message in the feed.
 */

export type Attachment = {
  url?: string;
  proxy_url?: string;
  filename?: string;
  content_type?: string;
  size?: number;
  width?: number | null;
  height?: number | null;
  spoiler?: boolean;
  /** The bot could not load it — a deleted message's CDN link 404s. */
  media_available?: boolean;
  /** One line saying why it cannot be shown, when it cannot. */
  unavailable_reason?: string;
};

export type Embed = {
  type?: string;
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  thumbnail?: string;
  video?: string;
  provider?: string;
};

const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const VIDEO_TYPES = /^video\//i;
const AUDIO_TYPES = /^audio\//i;

const isImage = (a: Attachment) =>
  (a.content_type ? IMAGE_TYPES.test(a.content_type) : false) ||
  /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(a.filename || a.url || "");

const isVideo = (a: Attachment) =>
  (a.content_type ? VIDEO_TYPES.test(a.content_type) : false) ||
  /\.(mp4|webm|mov|m4v)(\?|$)/i.test(a.filename || a.url || "");

const isAudio = (a: Attachment) =>
  (a.content_type ? AUDIO_TYPES.test(a.content_type) : false) ||
  /\.(mp3|ogg|wav|m4a|flac)(\?|$)/i.test(a.filename || a.url || "");

export const bytes = (n?: number) => {
  if (!n || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** Where to actually load the bytes from: the bot's proxy when it is there. */
const srcFor = (a: Attachment) => a.proxy_url || a.url || "";

/** The bot says this one is gone. Render the fact, never a broken player. */
const isGone = (a: Attachment) => a.media_available === false || !srcFor(a);

/** What kind of thing it is, for a label when it cannot be shown. */
const kindOf = (a: Attachment) =>
  isImage(a) ? "Image" : isVideo(a) ? "Video" : isAudio(a) ? "Audio" : "File";

function GoneTile({ a }: { a: Attachment }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/40 border border-slate-700/70 max-w-[300px]">
      <ImageOff className="w-3.5 h-3.5 text-slate-500 shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 truncate">
          {kindOf(a)} — {a.filename || "no filename"}
        </p>
        <p className="text-[10px] text-slate-500 truncate">
          {a.unavailable_reason || "deleted, so it can no longer be shown"}
        </p>
      </div>
    </div>
  );
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown) return <>{children}</>;
  return (
    <button
      onClick={() => setShown(true)}
      className="flex items-center gap-2 px-3 py-6 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-slate-400 hover:border-indigo-500 hover:text-indigo-300 transition w-full justify-center"
      data-tip="Hidden behind a spoiler — press to reveal"
    >
      <ImageOff className="w-4 h-4" />
      Spoiler — press to show
    </button>
  );
}

function ImageTile({
  src,
  alt,
  filename,
  onOpen,
  maxHeight = 220,
}: {
  src: string;
  alt: string;
  filename?: string;
  onOpen: (src: string) => void;
  maxHeight?: number;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (broken) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 text-[11px] text-slate-500">
        <ImageOff className="w-3.5 h-3.5" />
        {filename || "Image"} — could not be loaded
      </div>
    );
  }

  return (
    <button
      onClick={() => onOpen(src)}
      className="relative block rounded-xl overflow-hidden border border-slate-700/70 hover:border-indigo-500/60 transition group"
      data-tip="Press to enlarge"
    >
      {!loaded && <div className="w-40 h-28 bg-slate-800/60 animate-pulse" />}
      {/* lazy: a busy feed can hold dozens of images and none of them should load
          until they are near the viewport. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
        className={
          "block max-w-full object-cover rounded-xl transition group-hover:opacity-90 " +
          (loaded ? "opacity-100" : "opacity-0 absolute inset-0")
        }
        style={{ maxHeight }}
      />
    </button>
  );
}

export default function MessageMedia({
  attachments,
  embeds,
  apiBase,
}: {
  attachments?: Attachment[];
  embeds?: Embed[];
  /** The bot's base URL, so a relative proxy_url resolves. */
  apiBase?: string;
}) {
  // The lightbox takes a video as readily as a picture: a flagged clip is the
  // thing a moderator most needs to watch, and a 220px strip is not watching it.
  const [lightbox, setLightbox] = useState<{ src: string; video: boolean } | null>(null);

  // The bot returns proxy_url as a path on itself ("/api/media?url=…"), which is the
  // right thing for it to return — it does not know what host the app reached it on.
  // Resolve it once here against the base the rest of the app already uses, or the
  // app fetches /api/media from its own origin (tauri://localhost) and every image
  // fails with no obvious reason.
  const resolve = (raw: string) => {
    if (!raw) return "";
    if (/^https?:/i.test(raw)) return raw;
    const base = (apiBase || "").replace(/\/+$/, "");
    if (!base) return raw;
    return base + (raw.startsWith("/") ? raw : "/" + raw);
  };

  const withBase = (list?: Attachment[]): Attachment[] =>
    (Array.isArray(list) ? list : []).map((a) => ({
      ...a,
      proxy_url: a.proxy_url ? resolve(a.proxy_url) : a.proxy_url,
      url: a.url ? resolve(a.url) : a.url,
    }));

  const files = withBase(attachments).filter((a) => srcFor(a) || a.media_available === false);
  const linked = Array.isArray(embeds) ? embeds : [];

  // An embed's image is an attachment in all but name; only the ones with artwork
  // are worth a tile, and only when the same picture is not already in the strip.
  const embedImages = linked
    .flatMap((e) => [e.image, e.thumbnail, e.video])
    .filter((u): u is string => Boolean(u))
    .map(resolve);

  if (files.length === 0 && embedImages.length === 0 && linked.length === 0) return null;

  return (
    <>
      {(files.length > 0 || embedImages.length > 0) && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {files.map((a, i) =>
            isGone(a) ? (
              <GoneTile key={i} a={a} />
            ) : a.spoiler ? (
              <Spoiler key={i}>
                <ImageTile
                  src={srcFor(a)}
                  alt={a.filename || "attachment"}
                  filename={a.filename}
                  onOpen={(src) => setLightbox({ src, video: false })}
                />
              </Spoiler>
            ) : isImage(a) ? (
              <ImageTile
                key={i}
                src={srcFor(a)}
                alt={a.filename || "attachment"}
                filename={a.filename}
                onOpen={(src) => setLightbox({ src, video: false })}
              />
            ) : isVideo(a) ? (
              <div key={i} className="relative group">
                <video
                  src={srcFor(a)}
                  controls
                  preload="metadata"
                  className="rounded-xl border border-slate-700/70 max-h-[220px]"
                />
                <button
                  onClick={() => setLightbox({ src: srcFor(a), video: true })}
                  className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-black/60 text-[10px] text-slate-200 opacity-0 group-hover:opacity-100 transition"
                  data-tip="Watch it full size"
                >
                  Full size
                </button>
              </div>
            ) : isAudio(a) ? (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700">
                <Music className="w-3.5 h-3.5 text-emerald-300" />
                <audio src={srcFor(a)} controls className="h-8" />
                <span className="text-[11px] text-slate-400 max-w-[140px] truncate">{a.filename}</span>
              </div>
            ) : (
              <a
                key={i}
                href={srcFor(a)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700 hover:border-indigo-500/60 transition max-w-[280px]"
                data-tip="Open this file"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                <span className="text-[11px] text-slate-300 truncate">{a.filename || "file"}</span>
                <span className="text-[10px] text-slate-500 shrink-0">{bytes(a.size)}</span>
                <Download className="w-3 h-3 text-slate-500 shrink-0" />
              </a>
            )
          )}

          {embedImages.map((u, i) =>
            /\.(mp4|webm|mov)(\?|$)/i.test(u) ? (
              <video key={`e${i}`} src={u} controls preload="metadata" className="rounded-xl border border-slate-700/70 max-h-[220px]" />
            ) : (
              <ImageTile key={`e${i}`} src={u} alt="embed" onOpen={(src) => setLightbox({ src, video: false })} />
            )
          )}
        </div>
      )}

      {/* A link preview: title, a line of description, the site. No card chrome for
          something with nothing in it, which is most embeds. */}
      {linked
        .filter((e) => e.title || e.description)
        .slice(0, 3)
        .map((e, i) => (
          <a
            key={`l${i}`}
            href={e.url || "#"}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block rounded-lg border-l-2 border-indigo-400/60 bg-slate-800/40 px-3 py-1.5 hover:bg-slate-800/60 transition"
          >
            {e.provider && <span className="text-[10px] uppercase tracking-wide text-slate-500">{e.provider}</span>}
            {e.title && <p className="text-[12px] font-medium text-slate-200 truncate">{e.title}</p>}
            {e.description && (
              <p className="text-[11px] text-slate-400 line-clamp-2">{e.description}</p>
            )}
          </a>
        ))}

      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.94 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.94 }}
              className="max-h-full max-w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {lightbox.video ? (
                <video
                  src={lightbox.src}
                  controls
                  autoPlay
                  preload="auto"
                  className="max-h-[85vh] max-w-full rounded-xl shadow-2xl"
                />
              ) : (
                <img
                  src={lightbox.src}
                  alt="attachment"
                  className="max-h-full max-w-full rounded-xl shadow-2xl"
                />
              )}
            </motion.div>
            <button
              onClick={() => setLightbox(null)}
              className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white"
              data-tip="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
