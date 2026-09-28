/* Hand-placed landmarks, persisted per browser. Save (in the landmarks panel)
   writes the file the authority pass reads — a correction here becomes
   corrected evidence, not a local illusion. */

// Hand-placed landmarks are persisted per browser, and Save writes the file the
// authority pass reads — a correction here becomes corrected evidence, not a
// local illusion.
export let overrides={landmarks:{}};
try{const stored=localStorage.getItem('landmarkOverrides');if(stored)overrides=JSON.parse(stored)}catch(error){/* private mode */}
export function resetOverrides(){overrides={landmarks:{}}}

export function persistOverrides(){
  try{localStorage.setItem('landmarkOverrides',JSON.stringify(overrides))}catch(error){/* private mode */}
}
