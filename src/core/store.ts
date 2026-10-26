import { create } from 'zustand';
import { detectLocale } from '@/i18n';
import { createDemoProject, createEmptyProject } from './defaults';
import type { Project, RuntimeState, ToastItem, UiState } from './types';
import type { HistoryEntry } from './temporal';
import type { CommandSource } from './registry';

export interface AuditEntry {
  id: string;
  ts: number;
  type: string;
  source: CommandSource;
  ok: boolean;
  durationMs: number;
  label: string;
  error?: string;
  projectVersion: number;
}

export interface EditorState {
  project: Project;
  ui: UiState;
  runtime: RuntimeState;
  audit: AuditEntry[];
  past: HistoryEntry[];
  future: HistoryEntry[];
}

const demo = createDemoProject();

const initialRuntime: RuntimeState = {
  playhead: 0,
  playing: false,
  measuredFps: 0,
  exportProgress: { active: false, label: '', progress: 0 },
  bridge: { state: 'off', message: '', agents: 0 },
  aiBusy: false,
  toasts: [],
  captureRequestId: null,
  customCommands: [],
  customCommandsLoaded: false,
};

const initialUi: UiState = {
  selectedIds: [],
  activeLayerId: null,
  zoom: 0.34,
  panX: 80,
  panY: 40,
  leftTab: 'layers',
  rightTab: 'inspect',
  showTimeline: true,
  expandedTracks: [],
  selectedKeyframes: [],
  timelineZoom: 1,
  showSettings: false,
  settingsTab: 'ai',
  showLauncher: false,
  narrowDrawer: null,
  showExport: false,
  showPrompt: false,
  locale: detectLocale(),
  codeEditorFor: null,
  customEditorFor: null,
  customRunFor: null,
  windowMode: 'popup',
  floatingWindows: [],
  snapping: true,
  showSafeArea: false,
  inspectorSection: {
    transform: true,
    appearance: true,
    content: true,
    animation: false,
    bindings: false,
    timing: false,
  },
};

export const useEditor = create<EditorState>(() => ({
  project: demo,
  ui: initialUi,
  /* message 留空：文案由渲染层 t('未连接') 决定，模块初始化时还不知道用户语言 */
  runtime: { ...initialRuntime, playhead: demo.duration },
  audit: [],
  past: [],
  future: [],
}));

/* --------------------------------------------------------------- ui helpers */

export function updateUi(fn: (ui: UiState) => void): void {
  useEditor.setState((s) => {
    const next = { ...s.ui, inspectorSection: { ...s.ui.inspectorSection } };
    fn(next);
    return { ui: next };
  });
}

export function updateRuntime(fn: (rt: RuntimeState) => void): void {
  useEditor.setState((s) => {
    const next: RuntimeState = { ...s.runtime };
    fn(next);
    return { runtime: next };
  });
}

export function pushToast(kind: ToastItem['kind'], text: string, ttl = 3600): void {
  const item: ToastItem = { id: `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind, text, ttl };
  updateRuntime((rt) => {
    rt.toasts = [...rt.toasts.slice(-4), item];
  });
  window.setTimeout(() => {
    updateRuntime((rt) => {
      rt.toasts = rt.toasts.filter((t) => t.id !== item.id);
    });
  }, ttl);
}

export function dismissToast(id: string): void {
  updateRuntime((rt) => {
    rt.toasts = rt.toasts.filter((t) => t.id !== id);
  });
}

export function resetProjectState(project: Project): void {
  useEditor.setState({
    project,
    past: [],
    future: [],
    audit: [],
    ui: { ...initialUi, zoom: 0.34, panX: 80, panY: 40 },
    runtime: { ...useEditor.getState().runtime, playhead: project.duration, playing: false },
  });
}

export function newEmpty(): Project {
  return createEmptyProject();
}
