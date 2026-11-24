const phases = ['diagnosis', 'plan', 'lesson', 'done'];

export const STORAGE_KEY = 'lingra.workspace.v1';

export function blankWorkspace() {
  return { sessions: [], activeId: null };
}

function isSession(session) {
  return session && typeof session.id === 'string' && typeof session.goal === 'string' &&
    phases.includes(session.phase) && ['plan', 'attempts', 'reviews'].every((key) => Array.isArray(session[key]));
}

export function restoreWorkspace(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (!Array.isArray(saved?.sessions)) return blankWorkspace();

    const sessions = saved.sessions.filter(isSession);
    const activeId = sessions.some(({ id }) => id === saved.activeId) ? saved.activeId : sessions[0]?.id ?? null;
    return { sessions, activeId };
  } catch {
    return blankWorkspace();
  }
}

export function saveWorkspace(storage, workspace) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch {
    return false;
  }
}

export function storeSession(workspace, session) {
  const sessions = [session, ...workspace.sessions.filter(({ id }) => id !== session.id)];
  return { sessions, activeId: session.id };
}

export function selectSession(workspace, activeId) {
  return workspace.sessions.some(({ id }) => id === activeId) ? { ...workspace, activeId } : workspace;
}

export function removeSession(workspace, id) {
  const sessions = workspace.sessions.filter((entry) => entry.id !== id);
  const activeId = workspace.activeId === id ? sessions[0]?.id ?? null : workspace.activeId;
  return { sessions, activeId };
}
