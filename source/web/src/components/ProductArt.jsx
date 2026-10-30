const ART = {
  Keyboards: {
    tint: 'art-keyboards',
    shape: (
      <>
        <rect x="8" y="24" width="64" height="32" rx="5" />
        <path d="M16 33h4m6 0h4m6 0h4m6 0h4m6 0h4M16 41h4m6 0h4m6 0h4m6 0h4m6 0h4M24 49h32" />
      </>
    ),
  },
  Audio: {
    tint: 'art-audio',
    shape: (
      <>
        <path d="M16 46v-6a24 24 0 0 1 48 0v6" />
        <rect x="10" y="44" width="12" height="20" rx="4" />
        <rect x="58" y="44" width="12" height="20" rx="4" />
      </>
    ),
  },
  Displays: {
    tint: 'art-displays',
    shape: (
      <>
        <rect x="10" y="16" width="60" height="38" rx="4" />
        <path d="M32 66h16M40 54v12" />
      </>
    ),
  },
  Accessories: {
    tint: 'art-accessories',
    shape: (
      <>
        <rect x="14" y="30" width="52" height="22" rx="6" />
        <path d="M26 41h4m8 0h4m8 0h4M24 30V20m32 10V20M40 52v12" />
      </>
    ),
  },
};

export default function ProductArt({ category, small = false }) {
  const art = ART[category] ?? ART.Accessories;
  return (
    <div className={`product-art ${art.tint} ${small ? 'small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {art.shape}
      </svg>
    </div>
  );
}
