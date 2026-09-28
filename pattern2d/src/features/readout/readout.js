/* The panel in the top-right corner. It owns no numbers of its own: features
   register a provider and the panel composes whatever they return, so Edges can
   add its table under the piece Arrange is reporting on without either knowing
   about the other. A provider returns null when it has nothing to say. */
import {esc} from "../../shared/dom.js";

const providers = [];
let box = null;

const rowsHtml = list => (list || []).map(([k, v, monoKey]) =>
  `<tr><td${monoKey ? ' class="mono"' : ""}>${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join("");

const totalHtml = t => t ? `<tr class="tot"><td>${esc(t[0])}</td><td class="mono">${esc(t[1])}</td></tr>` : "";

/* pure: provider results -> the panel's markup, or "" when nobody claims the heading */
export function compose(results){
  const out = results.filter(Boolean);
  const main = out.find(o => o.title);
  if(!main) return "";
  return `<h3>${esc(main.title)}</h3><table>` + rowsHtml(main.rows) + totalHtml(main.total) +
    out.filter(o => o.section).map(s =>
      `<tr class="sec"><td colspan="2">${esc(s.section)}</td></tr>` + rowsHtml(s.rows) + totalHtml(s.total)
    ).join("") + `</table>`;
}

/* A tool's block, where the panel has room for it: a section under the heading of the piece or group selected —
   or, when nothing is selected and nobody claims the heading, the heading itself. Otherwise a Straight measurement
   between two pieces, or why a click could not start one, showed nowhere (point_to_point.md P8, 2026-09-24).
   `claimed`: something is selected, so Pieces or Arrange holds the heading. */
export const headed = (r, claimed) => !r || claimed ? r : {title: r.section, rows: r.rows, total: r.total};

/* a tool's last word — what it just did, or why it refused — as the panel's last row; the panel
   wraps it, so up to 160 characters say all of why (null when there is nothing to say) */
export const NOTE_MAX = 160;
export const noteRow = note => note ? ["›", note.length > NOTE_MAX ? note.slice(0, NOTE_MAX - 3) + "…" : note, false] : null;

export const Readout = {
  mount(ctx, ui){
    box = document.createElement("div");
    box.className = "readout"; box.id = "readout"; box.hidden = true;
    ui.stage.appendChild(box);
  },
  /* fn(ctx) -> {title, rows} for the heading, or {section, rows, total} to append */
  section(fn){ providers.push(fn); },
  render(ctx){
    if(!box) return;
    const html = compose(providers.map(fn => fn(ctx)));
    box.hidden = !html;
    if(html) box.innerHTML = html;
  }
};
