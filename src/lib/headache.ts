/**
 * Headache classification helper.
 *
 * Scores a set of yes/no answers against the ICHD-3 criteria for the common
 * primary headache types and returns ranked possibilities. It is deliberately
 * a *guide*, not a diagnosis: the output always says so, and anything that
 * looks secondary (thunderclap onset, fever, neuro deficit, new after 50, head
 * trauma, cancer history) is pulled out as a red flag regardless of score.
 *
 * Criteria sources:
 *   1.1 Migraine without aura      — ichd-3.org/1-migraine/1-1-migraine-without-aura
 *   1.2 Migraine with aura         — ichd-3.org/1-migraine/1-2-migraine-with-aura
 *   2.1 Infrequent episodic TTH    — ichd-3.org/2-tension-type-headache/2-1-...
 *   3.1 Cluster headache           — ichd-3.org/3-trigeminal-autonomic-cephalalgias/3-1-cluster-headache
 *   8.2 Medication-overuse headache
 *   10.x Headache attributed to disorder of homoeostasis (dehydration/missed meal)
 */

export type Answers = Record<string, boolean | number | null>;

export type Question = {
  id: string;
  text: string;
  hint?: string;
  kind: "bool" | "scale";
  /** Shown when the person says they aren't sure what they're feeling. */
  plain?: string;
};

export type RedFlag = { id: string; text: string; urgent: boolean };

export type Match = {
  id: string;
  label: string;
  score: number;
  confidence: "strong" | "possible" | "weak";
  because: string[];
  about: string;
};

/** Questions asked in order. Keep them short enough for a phone. */
export const QUESTIONS: Question[] = [
  {
    id: "aura",
    kind: "bool",
    text: "Before the pain, did you see flashing lights, zigzags, blind spots, or lose part of your vision?",
    plain: "Anything odd with your eyesight in the half hour before it started?",
  },
  {
    id: "aura_other",
    kind: "bool",
    text: "Before the pain, did you get numbness, tingling, or trouble finding words?",
    plain: "Any numbness, pins and needles, or struggling to speak just before?",
  },
  {
    id: "unilateral",
    kind: "bool",
    text: "Is the pain mostly on one side of your head?",
    plain: "One side, or all over?",
  },
  {
    id: "pulsating",
    kind: "bool",
    text: "Does it throb or pulse with your heartbeat?",
    plain: "Does it beat in time with your heart, or is it a steady ache?",
  },
  {
    id: "moderate_severe",
    kind: "bool",
    text: "Is the pain bad enough that it's hard to carry on with what you were doing?",
    plain: "Could you keep doing what you were doing, or did you have to stop?",
  },
  {
    id: "worse_movement",
    kind: "bool",
    text: "Does walking, bending, or climbing stairs make it worse?",
    plain: "Does moving about make it throb more?",
  },
  {
    id: "nausea",
    kind: "bool",
    text: "Do you feel sick, or have you been sick?",
    plain: "Any queasiness or vomiting?",
  },
  {
    id: "light_sound",
    kind: "bool",
    text: "Do light and sound bother you more than usual?",
    plain: "Does bright light or noise feel unbearable?",
  },
  {
    id: "pressing",
    kind: "bool",
    text: "Does it feel like a tight band or pressure, rather than a throb?",
    plain: "A tight squeeze round your head, or a beating pain?",
  },
  {
    id: "both_sides",
    kind: "bool",
    text: "Is it on both sides, fairly evenly?",
    plain: "Both sides at once?",
  },
  {
    id: "eye_tearing",
    kind: "bool",
    text: "Is one eye red, watering, or drooping, with a blocked or runny nostril on the same side?",
    plain: "Any redness, watering or drooping in one eye, or one nostril blocking up?",
  },
  {
    id: "restless",
    kind: "bool",
    text: "Do you feel restless or agitated — pacing, rocking, can't sit still?",
    plain: "Do you want to move about, or do you want to lie still in the dark?",
  },
  {
    id: "duration_hours",
    kind: "scale",
    text: "Roughly how many hours has it lasted so far?",
    hint: "0 if under half an hour",
  },
  {
    id: "days_per_month",
    kind: "scale",
    text: "In a typical month, how many days do you get a headache?",
  },
  {
    id: "acute_med_days",
    kind: "scale",
    text: "In a typical month, how many days do you take painkillers for it?",
    hint: "Count paracetamol, ibuprofen, triptans — anything for the headache",
  },
  {
    id: "thunderclap",
    kind: "bool",
    text: "Did it come on in under a minute, at full intensity, like a thunderclap?",
    plain: "Was it instant and severe, rather than building up?",
  },
  {
    id: "fever_neck",
    kind: "bool",
    text: "Do you have a fever, a stiff neck, or a rash that doesn't fade when pressed?",
    plain: "Any temperature, stiff neck, or a rash that stays when you press a glass on it?",
  },
  {
    id: "neuro_deficit",
    kind: "bool",
    text: "Any weakness, numbness, or trouble speaking that is still there now?",
    plain: "Anything still not working right — weakness, numbness, slurred speech?",
  },
  {
    id: "new_after_50",
    kind: "bool",
    text: "Is this a new kind of headache that started after age 50?",
  },
  {
    id: "head_injury",
    kind: "bool",
    text: "Have you hit your head in the last two weeks?",
  },
];

export const RED_FLAGS: RedFlag[] = [
  { id: "thunderclap", text: "Sudden severe headache peaking within a minute", urgent: true },
  { id: "fever_neck", text: "Fever with stiff neck or a rash that doesn't fade", urgent: true },
  { id: "neuro_deficit", text: "Ongoing weakness, numbness or speech trouble", urgent: true },
  { id: "new_after_50", text: "A brand new headache pattern after age 50", urgent: false },
  { id: "head_injury", text: "Headache after a head injury in the last fortnight", urgent: false },
];

const has = (a: Answers, id: string) => a[id] === true;
const num = (a: Answers, id: string) => (typeof a[id] === "number" ? (a[id] as number) : 0);

/**
 * Score the answers. Higher score = closer fit to that criteria set.
 * Deliberately simple and readable: each criterion met adds weight, and the
 * "because" list explains every point so the person can see the reasoning.
 */
export function classify(a: Answers): { matches: Match[]; flags: RedFlag[] } {
  const matches: Match[] = [];

  const flags = RED_FLAGS.filter((f) => has(a, f.id));

  // ── 1.1 Migraine without aura ──────────────────────────────
  {
    const because: string[] = [];
    let score = 0;
    const features = [has(a, "unilateral"), has(a, "pulsating"), has(a, "moderate_severe"), has(a, "worse_movement")];
    const featureCount = features.filter(Boolean).length;
    if (featureCount >= 2) {
      score += 30;
      because.push(`${featureCount} of the 4 migraine pain features`);
    }
    if (has(a, "nausea") || has(a, "light_sound")) {
      score += 25;
      because.push(has(a, "nausea") ? "nausea alongside it" : "light and sound sensitivity");
    }
    const dur = num(a, "duration_hours");
    if (dur >= 4 && dur <= 72) {
      score += 20;
      because.push("duration in the 4-72 hour range");
    } else if (dur > 0) {
      because.push(`duration of ${dur}h is outside the usual 4-72h window`);
    }
    if (!has(a, "aura") && !has(a, "aura_other")) {
      score += 10;
      because.push("no aura beforehand");
    }
    if (score > 0) {
      matches.push({
        id: "migraine_without_aura",
        label: "Migraine without aura",
        score,
        confidence: score >= 70 ? "strong" : score >= 45 ? "possible" : "weak",
        because,
        about:
          "The most common migraine type. Throbbing, often one-sided, worse on movement, with nausea or light/sound sensitivity, lasting 4-72 hours.",
      });
    }
  }

  // ── 1.2 Migraine with aura ─────────────────────────────────
  {
    const because: string[] = [];
    let score = 0;
    if (has(a, "aura") || has(a, "aura_other")) {
      score += 45;
      because.push(has(a, "aura") ? "visual aura before the pain" : "sensory or speech aura before the pain");
    }
    if (has(a, "unilateral") || has(a, "pulsating")) {
      score += 20;
      because.push("migrainous pain quality");
    }
    if (has(a, "light_sound") || has(a, "nausea")) {
      score += 15;
      because.push("light/sound sensitivity or nausea");
    }
    if (score >= 45) {
      matches.push({
        id: "migraine_with_aura",
        label: "Migraine with aura",
        score,
        confidence: score >= 70 ? "strong" : "possible",
        because,
        about:
          "Reversible visual or sensory symptoms (flashing lights, zigzags, blind spots, tingling, word-finding trouble) that build over minutes before the headache.",
      });
    }
  }

  // ── 2.x Tension-type headache ──────────────────────────────
  {
    const because: string[] = [];
    let score = 0;
    if (has(a, "pressing")) {
      score += 30;
      because.push("pressing or tightening rather than throbbing");
    }
    if (has(a, "both_sides")) {
      score += 25;
      because.push("pain on both sides");
    }
    if (!has(a, "worse_movement")) {
      score += 15;
      because.push("not made worse by movement");
    }
    if (!has(a, "nausea")) {
      score += 15;
      because.push("no nausea");
    }
    if (num(a, "duration_hours") >= 0.5) {
      score += 10;
      because.push("lasts half an hour or more");
    }
    if (score > 0 && !has(a, "aura") && !has(a, "aura_other")) {
      matches.push({
        id: "tension_type",
        label: "Tension-type headache",
        score,
        confidence: score >= 75 ? "strong" : score >= 50 ? "possible" : "weak",
        because,
        about:
          "A tight band of pressure on both sides, mild to moderate, not throbbing, and you can usually carry on. No nausea.",
      });
    }
  }

  // ── 3.1 Cluster headache ───────────────────────────────────
  {
    const because: string[] = [];
    let score = 0;
    if (has(a, "eye_tearing")) {
      score += 50;
      because.push("one-sided eye redness, watering, drooping or nostril blockage");
    }
    if (has(a, "restless")) {
      score += 30;
      because.push("restless and agitated rather than wanting to lie still");
    }
    if (has(a, "unilateral")) {
      score += 15;
      because.push("strictly one-sided pain");
    }
    if (score >= 50) {
      matches.push({
        id: "cluster",
        label: "Cluster headache",
        score,
        confidence: score >= 80 ? "strong" : "possible",
        because,
        about:
          "Very severe one-sided pain around the eye, with a red or watering eye, drooping lid or blocked nostril, and a strong urge to pace. Attacks often come in clusters at the same time each day.",
      });
    }
  }

  // ── 8.2 Medication-overuse headache ────────────────────────
  {
    const medDays = num(a, "acute_med_days");
    const headDays = num(a, "days_per_month");
    if (medDays >= 10 && headDays >= 15) {
      matches.push({
        id: "medication_overuse",
        label: "Medication-overuse headache",
        score: 60,
        confidence: "possible",
        because: [
          `${medDays} days a month on painkillers`,
          `${headDays} headache days a month`,
        ],
        about:
          "Headache that gets worse the more painkillers you take for it. Common above 10 days a month of acute medication. Worth raising with a GP before changing anything.",
      });
    }
  }

  // ── Homoeostasis / dehydration ─────────────────────────────
  {
    // No direct question, but very short duration + no other features lands here.
    const featureless =
      !has(a, "aura") &&
      !has(a, "aura_other") &&
      !has(a, "pulsating") &&
      !has(a, "pressing") &&
      !has(a, "eye_tearing");
    if (featureless && num(a, "duration_hours") > 0) {
      matches.push({
        id: "undifferentiated",
        label: "Unclear pattern",
        score: 20,
        confidence: "weak",
        because: ["no clear migraine or tension features in your answers"],
        about:
          "Your answers don't clearly match one type. That's common — keep logging episodes and a pattern may emerge. Worth mentioning to a GP if it keeps happening.",
      });
    }
  }

  matches.sort((x, y) => y.score - x.score);
  return { matches, flags };
}

/** Plain-language severity band from a 1-10 number. */
export function severityBand(n: number): { label: string; advice: string } {
  if (n <= 3) return { label: "Mild", advice: "Usually fine to carry on. Rest, water, and note what triggered it." };
  if (n <= 6)
    return {
      label: "Moderate",
      advice: "Stop what you're doing, lie down somewhere dark and quiet, take your usual painkiller early.",
    };
  if (n <= 8)
    return {
      label: "Severe",
      advice: "Lie down in a dark room. Take medication at the earliest sign next time — waiting makes it harder to shift.",
    };
  return {
    label: "Very severe",
    advice: "This is the level worth getting help with. If it came on suddenly or comes with weakness, fever or confusion, treat it as urgent.",
  };
}
