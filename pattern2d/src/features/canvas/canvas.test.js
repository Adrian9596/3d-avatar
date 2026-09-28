import {test, eq} from "../../../tests/harness.js";
import {withDom, emptyCtx} from "../../../tests/dom_fixture.js";
import {Canvas} from "./canvas.js";

/* dxf/open.md O2: the workspace starts with no file, and the toolbar is reachable then — so the
   canvas must take a pointer, a wheel and − / + without a view, and invent none. */
test("O2 with no file open the canvas ignores the pointer, the wheel, − / + and Fit", () => withDom(({ui, byId}) => {
  const ctx = emptyCtx();
  Canvas.mount(ctx, ui);
  for(const kind of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
    ui.svg.emit(kind, {clientX: 120, clientY: 80, pointerId: 1, button: 0});
  ui.svg.emit("wheel", {clientX: 120, clientY: 80, deltaY: 120});
  for(const id of ["zout", "zin", "fit"]) byId(id).click();
  eq(Canvas.view(), null, "no view invented");
}));
