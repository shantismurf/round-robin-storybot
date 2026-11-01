// Shared in-memory session state used across read, write, and edit modules.
// Kept separate to avoid circular imports.

export const pendingReadData = new Map();     // userId -> read session
export const lastReadPage = new Map();        // `${userId}_${storyId}` -> pageIndex
export const pendingEditData = new Map();     // userId -> edit session
export const pendingPreviewData = new Map();  // userId -> finalize preview session
export const pendingViewData = new Map();     // userId -> view-last-entry session
// A staged whole-story import, waiting on its confirm (story/_importStory.js). Holds the plan
// rather than the file: the file has already been parsed, resolved and checked by then, and the
// editor is approving what it would do, not the bytes.
export const pendingImportData = new Map();   // userId -> staged story import
