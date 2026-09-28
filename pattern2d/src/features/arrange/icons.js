/* Every icon draws the relation its command makes, at 16x16, in the current colour. */

export const ico = d => `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
  stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICO = {
  left:   '<path d="M2.4 2.2v11.6"/><rect x="4.6" y="3.6" width="9" height="3.3" rx=".8"/><rect x="4.6" y="9.1" width="5.6" height="3.3" rx=".8"/>',
  cx:     '<path d="M8 1.6v12.8"/><rect x="2.4" y="3.6" width="11.2" height="3.3" rx=".8"/><rect x="4.6" y="9.1" width="6.8" height="3.3" rx=".8"/>',
  right:  '<path d="M13.6 2.2v11.6"/><rect x="2.4" y="3.6" width="9" height="3.3" rx=".8"/><rect x="5.8" y="9.1" width="5.6" height="3.3" rx=".8"/>',
  top:    '<path d="M2.2 2.4h11.6"/><rect x="3.6" y="4.6" width="3.3" height="9" rx=".8"/><rect x="9.1" y="4.6" width="3.3" height="5.6" rx=".8"/>',
  cy:     '<path d="M1.6 8h12.8"/><rect x="3.6" y="2.4" width="3.3" height="11.2" rx=".8"/><rect x="9.1" y="4.6" width="3.3" height="6.8" rx=".8"/>',
  bottom: '<path d="M2.2 13.6h11.6"/><rect x="3.6" y="2.4" width="3.3" height="9" rx=".8"/><rect x="9.1" y="5.8" width="3.3" height="5.6" rx=".8"/>',
  disth:  '<path d="M1.5 2.4v11.2M14.5 2.4v11.2"/><rect x="6.4" y="4.4" width="3.2" height="7.2" rx=".8"/>',
  distv:  '<path d="M2.4 1.5h11.2M2.4 14.5h11.2"/><rect x="4.4" y="6.4" width="7.2" height="3.2" rx=".8"/>',
  row:    '<rect x="1.6" y="3" width="3.4" height="9" rx=".8"/><rect x="6.3" y="3" width="3.4" height="6.2" rx=".8"/><rect x="11" y="3" width="3.4" height="7.8" rx=".8"/>',
  col:    '<rect x="3" y="1.6" width="9" height="3.4" rx=".8"/><rect x="3" y="6.3" width="6.2" height="3.4" rx=".8"/><rect x="3" y="11" width="7.8" height="3.4" rx=".8"/>',
  grid:   '<rect x="1.8" y="1.8" width="5.4" height="5.4" rx=".8"/><rect x="8.8" y="1.8" width="5.4" height="5.4" rx=".8"/><rect x="1.8" y="8.8" width="5.4" height="5.4" rx=".8"/><rect x="8.8" y="8.8" width="5.4" height="5.4" rx=".8"/>',
  undo:   '<path d="M2.6 8.2a5.4 5.4 0 1 1 1.9 4.1"/><path d="M2.4 3.6v4h4"/>'
};
