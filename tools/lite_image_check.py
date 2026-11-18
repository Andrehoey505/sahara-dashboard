#!/usr/bin/env python3
"""BabbleBot Lite's image checker.

## What this is

A tiny, single-purpose worker that the dashboard runs *only while Lite is in
charge*. It takes image paths on stdin, one per line, and prints one JSON verdict
per image on stdout. It holds no state, opens no ports, and touches no database.

## Why a separate process and not a Rust library

The detector is a 12 MB ONNX model that needs onnxruntime, and this Mac is an M1
with a CoreML execution provider available. Python gets that with one import;
wiring ONNX into the Rust binary would mean a build toolchain and a model file to
manage. A worker that lives exactly as long as Lite does is also the safest shape:
when Lite stops, the process exits and the model is gone from memory, which is
what Andre asked for -- it loads only while Lite is covering.

## The one rule that matters

**Nothing here deletes anything.** It reports. The decision belongs to the Rust
client, which applies the same `AUTO_DELETE_VIOLATION_TYPES` list the Windows bot
uses, and the same channel switches. A detector that convicts is a detector that
gets someone banned for a photo of a statue.

## Verdict shape

    {"path": "...", "nsfw": true, "score": 0.93, "labels": ["FEMALE_BREAST_EXPOSED"], "error": null}

`nsfw` is true only when a label on the exposed list is present with confidence at
or above `THRESHOLD`. Everything else is reported as not-nsfw, including errors --
an unreadable image is not evidence.
"""

import json
import sys

# Labels that mean exposed nudity. Deliberately the explicit ones only: the model
# also has suggestive labels (covered breasts, covered male genitals) which are
# ordinary pictures of people and must never be treated as a breach.
NSFW_LABELS = {
    "FEMALE_GENITALIA_EXPOSED",
    "MALE_GENITALIA_EXPOSED",
    "FEMALE_BREAST_EXPOSED",
    "ANUS_EXPOSED",
    "BUTTOCKS_EXPOSED",
}

# The Windows bot's sensitivity switch moves this. 0.6 is "normal": high enough
# that a swimsuit is not a breach, low enough that a clear exposure is caught.
THRESHOLD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.6


def main() -> None:
    try:
        from nudenet import NudeDetector
    except Exception as e:  # pragma: no cover - environment problem, reported
        print(json.dumps({"fatal": f"nudenet is not installed: {e}"}), flush=True)
        return

    try:
        detector = NudeDetector()
    except Exception as e:  # pragma: no cover
        print(json.dumps({"fatal": f"could not load the model: {e}"}), flush=True)
        return

    # Tell the caller the model is loaded and listening.
    print(json.dumps({"ready": True, "threshold": THRESHOLD}), flush=True)

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            detections = detector.detect(path)
        except Exception as e:
            print(
                json.dumps(
                    {"path": path, "nsfw": False, "score": 0.0, "labels": [], "error": str(e)}
                ),
                flush=True,
            )
            continue

        hits = [
            d
            for d in detections
            if d.get("class") in NSFW_LABELS and float(d.get("score", 0)) >= THRESHOLD
        ]
        best = max((float(d.get("score", 0)) for d in hits), default=0.0)
        print(
            json.dumps(
                {
                    "path": path,
                    "nsfw": bool(hits),
                    "score": round(best, 3),
                    "labels": sorted({d.get("class") for d in hits}),
                    "error": None,
                }
            ),
            flush=True,
        )


if __name__ == "__main__":
    main()
