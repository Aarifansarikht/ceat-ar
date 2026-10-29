export default function IntroScreen({ config, onStart }) {
  const { brand, target } = config;
  return (
    <main className="intro">
      <header className="brand-bar">
        <img src={brand.logo} alt={brand.name} className="brand-logo" />
        <span className="brand-tag">AR Experience</span>
      </header>

      <section className="intro-hero">
        <div className="intro-preview" aria-hidden="true">
          <img src={target.image} alt="" />
          <span className="intro-preview-scan" />
        </div>
        <p className="eyebrow">{brand.productLine}</p>
        <h1>
          See the tyre <em>in 3D</em>, right on the poster
        </h1>
        <p className="lede">{brand.tagline}</p>
      </section>

      <ol className="steps">
        <li>
          <span>1</span>
          <p>Tap <strong>Start AR</strong> and allow camera access.</p>
        </li>
        <li>
          <span>2</span>
          <p>Point your camera at the {brand.name} poster so it fills most of the screen.</p>
        </li>
        <li>
          <span>3</span>
          <p>Hold steady until the tyre appears. Drag sideways to turn it.</p>
        </li>
      </ol>

      <div className="intro-actions">
        <button type="button" className="btn btn-primary" onClick={onStart}>
          Start AR
        </button>
        <a className="link-subtle" href={target.image} target="_blank" rel="noreferrer">
          No poster? Open the target image on another screen
        </a>
      </div>
    </main>
  );
}
