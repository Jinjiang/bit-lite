const previewVendorClosers = new Set<() => Promise<void> | void>();

export function registerPreviewVendorCloser(closer: () => Promise<void> | void) {
  previewVendorClosers.add(closer);
  return () => previewVendorClosers.delete(closer);
}

export async function closePreviewVendorServers() {
  const closers = Array.from(previewVendorClosers);
  previewVendorClosers.clear();
  await Promise.all(closers.map((closer) => closer()));
}
