export default function sitemap() {
  const base = 'https://truthlens.ai';
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now },
    { url: `${base}/#/home`, lastModified: now },
    { url: `${base}/#/library`, lastModified: now },
  ];
}
