'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Exposed only to the local setup page (file://); the UON CONNECT pages never get it.
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('uonSetup', { setServer: (url) => ipcRenderer.invoke('uon:set-server', url) });
}
