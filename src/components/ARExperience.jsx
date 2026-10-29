import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AR_STATES, arReducer, initialARState } from '../ar/arStates.js';
import AROverlay from './AROverlay.jsx';
import IntroScreen from './IntroScreen.jsx';

const showDiagnostics = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');

// The tracking engine (MindAR + TensorFlow.js, ~300 kB gzip) is loaded on
// demand so the intro paints fast; it is prefetched while the intro is shown.
let sessionModule;
const loadSessionModule = () => (sessionModule ??= import('../ar/ARSession.js'));

/**
 * Owns the AR session lifecycle and maps its coarse events onto the UI state
 * machine. The session is created from the Start click (not on mount), so
 * React StrictMode's double-mount never opens the camera twice.
 */
export default function ARExperience({ config }) {
  const [state, dispatch] = useReducer(arReducer, initialARState);
  const [spinning, setSpinning] = useState(false);
  const stageRef = useRef(null);
  const sessionRef = useRef(null);
  const startingRef = useRef(false);
  const diagRef = useRef(null);

  const teardown = useCallback(() => {
    startingRef.current = false;
    sessionRef.current?.destroy();
    sessionRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current || startingRef.current || !stageRef.current) return;
    startingRef.current = true;
    setSpinning(false);
    // Dispatch synchronously so the intro disappears on tap, before the permission prompt.
    dispatch({ status: AR_STATES.REQUESTING_CAMERA });

    let ARSession;
    try {
      ({ ARSession } = await loadSessionModule());
    } catch {
      sessionModule = undefined; // allow a retry to re-fetch
      startingRef.current = false;
      dispatch({
        status: AR_STATES.ERROR,
        error: { code: 'asset-load', message: 'The AR engine could not be downloaded. Check your connection.' },
      });
      return;
    }
    if (!startingRef.current) return; // user exited while the engine was loading
    startingRef.current = false;

    const session = new ARSession({
      container: stageRef.current,
      config,
      onPhase: (phase) => dispatch({ status: phase }),
      onTracking: (s) =>
        dispatch({ status: s === 'found' ? AR_STATES.TARGET_FOUND : AR_STATES.TRACKING_LOST }),
      onError: (error) => {
        if (sessionRef.current === session) sessionRef.current = null;
        dispatch({ status: AR_STATES.ERROR, error });
      },
      // Written straight to the DOM: diagnostics must not re-render React every second.
      onDiagnostics: showDiagnostics
        ? ({ trackingFps, renderFps }) => {
            if (diagRef.current) diagRef.current.textContent = `track ${trackingFps} fps · render ${renderFps} fps`;
          }
        : undefined,
    });
    sessionRef.current = session;
    session.start();
  }, [config]);

  const exit = useCallback(() => {
    teardown();
    dispatch({ status: AR_STATES.INTRO });
  }, [teardown]);

  const rescan = useCallback(() => {
    sessionRef.current?.resetView();
    sessionRef.current?.rescan();
  }, []);

  const toggleSpin = useCallback(() => {
    setSpinning((on) => {
      sessionRef.current?.setSpin(!on);
      return !on;
    });
  }, []);

  const resetView = useCallback(() => {
    setSpinning(false);
    sessionRef.current?.setSpin(false);
    sessionRef.current?.resetView();
  }, []);

  // Release camera, worker and GPU resources if the component unmounts mid-session.
  useEffect(() => teardown, [teardown]);

  useEffect(() => {
    const id = setTimeout(() => loadSessionModule().catch(() => {}), 300);
    return () => clearTimeout(id);
  }, []);

  const inAR = state.status !== AR_STATES.INTRO;

  return (
    <div className="ar-root" data-ar-state={state.status}>
      {/* Camera <video> and WebGL <canvas> are inserted here by ARSession. */}
      <div ref={stageRef} className="ar-stage" aria-hidden="true" />

      {inAR && (
        <AROverlay
          config={config}
          state={state}
          spinning={spinning}
          onExit={exit}
          onRescan={rescan}
          onRetry={() => {
            teardown();
            start();
          }}
          onToggleSpin={toggleSpin}
          onResetView={resetView}
        />
      )}
      {!inAR && <IntroScreen config={config} onStart={start} />}
      {showDiagnostics && inAR && <div ref={diagRef} className="ar-diagnostics" />}
    </div>
  );
}
