import { PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface NativeCaptionEvent {
  type: 'status' | 'partial' | 'final' | 'error';
  text?: string;
  message?: string;
  running?: boolean;
}

export interface NativeAsrPlugin {
  start(): Promise<{ running: boolean }>;
  stop(): Promise<{ running: boolean }>;
  status(): Promise<{ running: boolean }>;
  configure(options: { vibrationEnabled: boolean; sensitivity: number; language: string }): Promise<{ running: boolean }>;
  requestPermissions(options?: { permissions?: string[] }): Promise<Record<string, string>>;
  addListener(
    eventName: 'caption',
    listenerFunc: (event: NativeCaptionEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const NativeAsr = registerPlugin<NativeAsrPlugin>('NativeAsr');
