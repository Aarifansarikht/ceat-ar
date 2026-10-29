import { useEffect, useState } from 'react';

/**
 * Scanning reticle shaped like the target (portrait poster). It is guidance
 * only — MindAR exposes no detection progress, so none is shown.
 */
export default function ScanGuide({ aspect, hintAfterMs }) {
  const [showTips, setShowTips] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setShowTips(true), hintAfterMs);
    return () => clearTimeout(id);
  }, [hintAfterMs]);

  return (
    <div className="scan-guide">
      <div className="reticle" style={{ aspectRatio: `1 / ${aspect}` }}>
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <span className="scanline" />
      </div>
      <p className="scan-text">Fit the poster inside the frame</p>
      {showTips && (
        <ul className="scan-tips" role="status">
          <li>Make sure the poster is well lit, without glare</li>
          <li>Move a little closer or further away</li>
          <li>Hold the phone steady for a moment</li>
        </ul>
      )}
    </div>
  );
}
