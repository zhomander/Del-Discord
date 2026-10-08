// Del-Discord v1 — personal source modules.

export function insertCss(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}
