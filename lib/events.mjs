import { EventEmitter } from 'node:events';

// Document change notifications: the document service emits, the SSE
// route subscribes. In-process only, matching the single-process design.
export const docEvents = new EventEmitter();
docEvents.setMaxListeners(100);
export function emitDocumentChanged(id) {
  try { docEvents.emit('changed', id); } catch (e) { console.error(`[truthlens] document event failed for ${id}:`, e); }
}
