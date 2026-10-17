/** Library screen-reader announcements (#libraryLiveRegion). */
export function announce(text: string): void {
  const region = document.getElementById("libraryLiveRegion");
  if (region) region.textContent = text;
}
