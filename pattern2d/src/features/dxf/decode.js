/* DXF text comes in whatever the drafter's CAD wrote: factory files from Richpeace
   carry GBK piece names (杯面, 后比). Strict UTF-8 first — it throws on GBK bytes —
   then fall back, rather than guessing from the file name. */

export function decode(buf, mode){
  const tryDec = (enc, fatal) => new TextDecoder(enc, {fatal}).decode(buf);
  if(mode && mode !== "auto"){ try{ return tryDec(mode,false); }catch(e){ return tryDec("utf-8",false); } }
  try{ return tryDec("utf-8", true); }              // strict: throws on GBK bytes
  catch(e){ try{ return tryDec("gbk", false); }catch(e2){ return tryDec("utf-8", false); } }
}
