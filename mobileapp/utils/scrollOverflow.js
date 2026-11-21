export function hasMoreContent(contentSize, viewportSize, offset = 0) {
  return viewportSize > 0 && contentSize > viewportSize + offset + 12;
}
