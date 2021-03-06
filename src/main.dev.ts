/* eslint global-require: off, no-console: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./src/main.prod.js` using webpack. This gives us some performance wins.
 */
import 'core-js/stable';
import 'regenerator-runtime/runtime';
import path from 'path';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import MenuBuilder from './menu';

const CHP = require('@andrewdbinder/chp-lights-module');
const SerialPort = require('serialport');

const { channels } = require('./components/channels.js');

const comPath = 'COM12';
let port = new SerialPort(comPath, {
  baudRate: 115200,
});

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();
  }
}

let mainWindow: BrowserWindow | null = null;

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    backgroundColor: '#F7C136',
    show: false,
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    frame: false,
    titleBarStyle: 'hidden',
    icon: getAssetPath('icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      devTools: true,
    },
  });

  // mainWindow.webContents.openDevTools();
  // mainWindow.setMenuBarVisibility(false);

  mainWindow.loadURL(`file://${__dirname}/index.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(createWindow).catch(console.log);

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) createWindow();
});

// IPC Events

ipcMain.on(channels.APP_INFO, (event) => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    event.sender.send(channels.APP_INFO, {
      appName: 'CHP Lighting Controller',
      appVersion: 'DEVELOPMENT',
    });
  } else {
    event.sender.send(channels.APP_INFO, {
      appName: app.getName(),
      appVersion: app.getVersion(),
    });
  }
});

ipcMain.on(channels.CHP_STATE_CHANGE, (event, args) => {
  // console.log(`Received ${args[0]}`);

  // Send state command
  // CHP.ChangeState(args[0]);

  // Read state and reply
  // const state = CHP.GetState();
  // event.sender.send(channels.GET_CHP_STATE, {
  //   CHPState: state,
  // });

  if (port.isOpen) {
    if (args) {
      // let result = await writeToSerial(args[0], event);
      port.write(args[0], (error: any) => {
        if (error) {
          console.log('Error with write');
          console.log(error);
          event.sender.send(channels.COM_STATUS, {
            status: port.isOpen,
            port: port.path,
          });
        } else {
          console.log(`Wrote ${args[0]}`);
          CHP.ChangeState(args[0]);
          const state = CHP.GetState();
          event.sender.send(channels.GET_CHP_STATE, {
            CHPState: state,
          });
        }
      });
    }
  }
});

ipcMain.on(channels.GET_CHP_STATE, (event) => {
  // Read state and reply
  const state = CHP.GetState();
  event.sender.send(channels.GET_CHP_STATE, {
    CHPState: state,
  });
});

ipcMain.on(channels.COM_STATUS, (event) => {
  event.sender.send(channels.COM_STATUS, {
    comStatus: port.isOpen,
    comPort: port.path,
  });
});

ipcMain.on(channels.COM_SCAN, async (event) => {
  const ports = await SerialPort.list();
  console.log('Scan request received.');

  event.sender.send(channels.COM_SCAN, {
    portList: ports,
  });

  console.log(ports);
});

ipcMain.on(channels.COM_CONNECT, async (event, args) => {
  console.log(`Opening COM Port: ${args}`);

  port = new SerialPort(args, {
    baudRate: 115200,
  });

  port.open((err: any) => {
    if (err) {
      console.log(`${port.path} is still opening.`);
    }
  });

  port.on('open', () => {
    event.sender.send(channels.COM_STATUS, {
      comStatus: port.isOpen,
      comPort: port.path,
    });
  });

  port.on('error', (err: any) => {
    console.log('Error: ', err.message);
    event.sender.send(channels.COM_STATUS, {
      comStatus: port.isOpen,
      comPort: port.path,
    });
  });
});

ipcMain.on(channels.COM_DISCONNECT, async (event) => {
  console.log('Disconnecting COM Port.');

  port.close();
  event.sender.send(channels.COM_STATUS, {
    comStatus: port.isOpen,
    comPort: port.path,
  });
});
