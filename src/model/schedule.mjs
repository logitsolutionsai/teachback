// Spaced review per item: an SM-2 variant with calendar-day intervals.
// See references/learner-model.md for the rules and a worked example.
import { addDays, round } from '../util.mjs';

export const DEFAULT_SCHEDULE = Object.freeze({
  initialEase: 2.5,
  minEase: 1.3,
  maxEase: 3.0,
  firstInterval: 1, // days after the first correct answer
  secondInterval: 3, // days after the second correct answer
  easeBonus: 0.1, // correct and confident (or no confidence given)
  lapseEasePenalty: 0.2, // wrong
  partialEasePenalty: 0.15 // partially correct
});

export function newSchedule(params = DEFAULT_SCHEDULE) {
  return { reps: 0, ease: params.initialEase, interval: 0, lapses: 0, dueDay: null, lastDay: null };
}

// prev: schedule or null. result: correct | partial | wrong. today: "YYYY-MM-DD".
// confidence (1-4) is optional; a correct answer given with confidence 1-2
// still counts, but earns no ease bonus.
export function nextSchedule(prev, result, today, { confidence, params = DEFAULT_SCHEDULE } = {}) {
  const s = prev ? { ...prev } : newSchedule(params);
  const early = prev && prev.dueDay && today < prev.dueDay;

  if (result === 'wrong') {
    if (s.reps > 0) s.lapses += 1; // forgot something it had recalled before
    s.reps = 0;
    s.interval = 1;
    s.ease = round(Math.max(params.minEase, s.ease - params.lapseEasePenalty), 2);
  } else if (result === 'partial') {
    s.interval = Math.max(1, Math.round(s.interval / 2));
    s.ease = round(Math.max(params.minEase, s.ease - params.partialEasePenalty), 2);
  } else if (result === 'correct') {
    if (early) {
      // Answered again before it was due: no change, so cramming cannot stretch intervals.
      s.lastDay = today;
      return s;
    }
    s.reps += 1;
    if (s.reps === 1) s.interval = params.firstInterval;
    else if (s.reps === 2) s.interval = params.secondInterval;
    else s.interval = Math.round(s.interval * s.ease);
    const unsure = confidence != null && confidence <= 2;
    if (!unsure) s.ease = round(Math.min(params.maxEase, s.ease + params.easeBonus), 2);
  } else {
    throw new Error(`Unknown result "${result}"`);
  }
  s.dueDay = addDays(today, s.interval);
  s.lastDay = today;
  return s;
}

export function isDue(schedule, today) {
  return Boolean(schedule && schedule.dueDay && schedule.dueDay <= today);
}
