/**
 * Explicit UI state machine. Any transition not listed here is rejected, so
 * e.g. a late "found" event after the user pressed Exit cannot resurrect the
 * AR view, and Start cannot be triggered twice.
 */
export const AR_STATES = /** @type {const} */ ({
  INTRO: 'intro',
  REQUESTING_CAMERA: 'requesting-camera',
  INITIALIZING: 'initializing',
  SCANNING: 'scanning',
  TARGET_FOUND: 'target-found',
  TRACKING_LOST: 'tracking-lost',
  ERROR: 'error',
});

const S = AR_STATES;
const TRANSITIONS = {
  [S.INTRO]: [S.REQUESTING_CAMERA],
  [S.REQUESTING_CAMERA]: [S.INITIALIZING, S.ERROR, S.INTRO],
  [S.INITIALIZING]: [S.SCANNING, S.ERROR, S.INTRO],
  [S.SCANNING]: [S.TARGET_FOUND, S.INITIALIZING, S.ERROR, S.INTRO],
  [S.TARGET_FOUND]: [S.TRACKING_LOST, S.INITIALIZING, S.ERROR, S.INTRO],
  [S.TRACKING_LOST]: [S.TARGET_FOUND, S.INITIALIZING, S.ERROR, S.INTRO],
  [S.ERROR]: [S.REQUESTING_CAMERA, S.INTRO],
};

export const initialARState = { status: S.INTRO, error: null };

export function arReducer(state, action) {
  const next = action.status;
  if (next === state.status || !TRANSITIONS[state.status].includes(next)) {
    if (import.meta.env.DEV && next !== state.status) {
      console.warn(`[AR] ignored transition ${state.status} → ${next}`);
    }
    return state;
  }
  return {
    status: next,
    error: next === S.ERROR ? action.error : null,
  };
}
