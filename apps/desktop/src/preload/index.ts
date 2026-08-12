import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AgentEvent,
  type CommandMap,
  type CommandResultMap,
  type GetMailThreadRequest,
  type ListMailThreadsRequest,
  type MailThreadListPage,
  type MailThreadPage,
  type OutreachrBridge,
} from '../shared/contracts';

const bridge: OutreachrBridge = {
  bootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.bootstrap),
  command: <K extends keyof CommandMap>(command: K, payload: CommandMap[K]) =>
    ipcRenderer.invoke(IPC_CHANNELS.command, command, payload) as Promise<CommandResultMap[K]>,
  listMailThreads: (request: ListMailThreadsRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.listMailThreads, request) as Promise<MailThreadListPage>,
  getMailThread: (request: GetMailThreadRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.getMailThread, request) as Promise<MailThreadPage>,
  cancelMailRequest: (requestId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelMailRequest, requestId) as Promise<void>,
  selectFile: (filters) => ipcRenderer.invoke(IPC_CHANNELS.selectFile, filters),
  selectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectDirectory),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  revealPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealPath, path),
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  openLegal: (document) => ipcRenderer.invoke(IPC_CHANNELS.openLegal, document),
  onAgentEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: AgentEvent): void =>
      listener(payload);
    ipcRenderer.on(IPC_CHANNELS.agentEvent, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.agentEvent, wrapped);
  },
};

contextBridge.exposeInMainWorld('outreachr', Object.freeze(bridge));
