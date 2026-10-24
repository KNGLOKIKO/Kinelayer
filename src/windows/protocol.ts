import type { CommandResult } from '@/core/registry';
import type { Project } from '@/core/types';

export const CHANNEL_NAME = 'poster-editor';

export interface SnapshotMessage {
  kind: 'snapshot';
  seq: number;
  hostId: string;
  layerId: string;
  project: Project;
  time: number;
  playing: boolean;
  selection: string[];
}

export interface HelloMessage {
  kind: 'host.hello';
  hostId: string;
  layerId: string;
  projectName: string;
  startedAt: number;
}

export interface TimeMessage {
  kind: 'time';
  hostId: string;
  playing: boolean;
  time: number;
}

export interface ResultMessage {
  kind: 'command.result';
  hostId: string;
  layerId: string;
  requestId: string;
  result: CommandResult;
}

export interface ByeMessage {
  kind: 'host.bye';
  hostId: string;
}

export type HostToClient = HelloMessage | SnapshotMessage | TimeMessage | ResultMessage | ByeMessage;

export interface ClientHello {
  kind: 'client.hello';
  layerId: string;
  wantHostId: string | null;
}

export interface CommandRequest {
  kind: 'command.request';
  hostId: string;
  layerId: string;
  requestId: string;
  type: string;
  payload: unknown;
}

export interface ClientBye {
  kind: 'client.bye';
  hostId: string;
  layerId: string;
}

export type ClientToHost = ClientHello | CommandRequest | ClientBye;

export function channelName(hostId?: string): string {
  return hostId ? `${CHANNEL_NAME}:${hostId}` : CHANNEL_NAME;
}
