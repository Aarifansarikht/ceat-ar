import { useState } from 'react';
import { AR_STATES } from '../ar/arStates.js';
import ScanGuide from './ScanGuide.jsx';

const S = AR_STATES;

const ERROR_TITLES = {
  'permission-denied': 'Camera access needed',
  'insecure-context': 'Secure connection required',
  'no-camera': 'No camera found',
  'camera-busy': 'Camera unavailable',
  unsupported: 'Browser not supported',
  'webgl-unavailable': '3D not available',
  'asset-load': 'Could not load content',
  'tracking-init': 'AR could not start',
};

export default function AROverlay({
  config,
  state,
  spinning,
  onExit,
  onRescan,
  onRetry,
  onToggleSpin,
  onResetView,
}) {
  const { status, error } = state;
  const [showInfo, setShowInfo] = useState(false);
  const live = status === S.TARGET_FOUND || status === S.TRACKING_LOST;

  return (
    <div className="overlay">
      <header className="overlay-top">
        <div className="brand-chip">
          <img src={config.brand.logo} alt={config.brand.name} />
        </div>
        <button type="button" className="icon-btn" onClick={onExit} aria-label="Exit AR">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {(status === S.REQUESTING_CAMERA || status === S.INITIALIZING) && (
        <div className="center-status" role="status">
          <span className="spinner" />
          <p>{status === S.REQUESTING_CAMERA ? 'Waiting for camera access…' : 'Preparing AR…'}</p>
          {status === S.REQUESTING_CAMERA && <small>Tap “Allow” when your browser asks.</small>}
        </div>
      )}

      {status === S.SCANNING && (
        <ScanGuide aspect={config.target.aspect} hintAfterMs={config.tracking.scanHintAfterMs} />
      )}

      {status === S.TARGET_FOUND && (
        <div className="toast toast-ok" role="status">
          <span className="dot" /> Poster detected
        </div>
      )}

      {status === S.TRACKING_LOST && (
        <div className="toast toast-warn" role="status">
          Poster out of view — point your camera back at it
        </div>
      )}

      {status === S.ERROR && error && (
        <div className="error-card" role="alert">
          <h2>{ERROR_TITLES[error.code] ?? 'Something went wrong'}</h2>
          <p>{error.message}</p>
          <div className="error-actions">
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Try again
            </button>
            <button type="button" className="btn btn-ghost" onClick={onExit}>
              Back
            </button>
          </div>
        </div>
      )}

      {live && (
        <footer className="overlay-bottom">
          {showInfo && (
            <ul className="feature-list">
              {config.brand.features.map((f) => (
                <li key={f.title}>
                  <strong>{f.title}</strong>
                  <span>{f.body}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="control-bar">
            <button type="button" className={`ctrl ${spinning ? 'is-on' : ''}`} onClick={onToggleSpin} aria-pressed={spinning}>
              Spin
            </button>
            <button type="button" className={`ctrl ${showInfo ? 'is-on' : ''}`} onClick={() => setShowInfo((v) => !v)} aria-pressed={showInfo}>
              Details
            </button>
            <button type="button" className="ctrl" onClick={onResetView}>
              Reset
            </button>
            <button type="button" className="ctrl" onClick={onRescan}>
              Rescan
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
