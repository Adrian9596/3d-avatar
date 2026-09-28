/* The DXF side of the Measure Engine suite: files written by ezdxf (tests/fixtures/engine/)
   and a few real files of the DXF library, with the numbers ezdxf measured on them.

   Both come from scripts/make_engine_fixtures.py. Every file is checked against the sha256
   recorded next to its expected values: a changed file must fail loudly as "stale fixture",
   not quietly compare a new drawing against old numbers. */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {decode} from "../src/features/dxf/decode.js";
import {parseDXF} from "../src/features/dxf/parse.js";
import {buildModel} from "../src/features/dxf/model.js";
import {dataPath, hasData, missing, NeedsData} from "./data.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
/* the synthetic half: files written by ezdxf, in the repo */
const meta = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/engine/expected.json", import.meta.url)), "utf8"));
/* the library half ("lib:" files and the numbers ezdxf took from them) is factory data: the file that
   holds it is read from the data folder's own tests/fixtures/engine/expected.json and not copied into
   the repo (a few of those numbers are quoted, rounded, in the specs — CLAUDE.md §9) */
const LIB_META = "tests/fixtures/engine/expected.json";
const libMeta = hasData ? JSON.parse(readFileSync(dataPath(LIB_META), "utf8")) : null;

export const expected = {...meta.expected, lib: libMeta ? libMeta.expected.lib : missing(`${LIB_META} → expected.lib`)};

/* raw bytes of a fixture, after proving they are the bytes the expected values belong to */
export function bytes(key){
  const lib = key.startsWith("lib:");
  if(lib && !libMeta) throw new NeedsData(`DXF file/ (${key})`);
  const f = (lib ? libMeta : meta).files[key];
  if(!f) throw new Error(`không có fixture "${key}" — chạy python3 scripts/make_engine_fixtures.py`);
  const buf = readFileSync(lib ? dataPath(f.path) : ROOT + f.path);
  const sha = createHash("sha256").update(buf).digest("hex");
  if(sha !== f.sha256) throw new Error(`fixture cũ: ${f.path} đã đổi — chạy lại make_engine_fixtures.py`);
  return buf;
}

export const dxfOf = key => parseDXF(decode(new Uint8Array(bytes(key))));
export const modelOf = (key, opts) => buildModel(dxfOf(key), opts);
export const pieceOf = (model, block) => model.pieces.find(p => p.blockName === block || p.name === block);

/* every layer on — the tests choose their line by where they click, like TD does */
export const ALL_ON = new Proxy({}, {get: () => true});
