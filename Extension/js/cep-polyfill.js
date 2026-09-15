/**
 * SharkMotion Tools CEP & Web Runtime Polyfill
 * Ensures 100% standalone and iframe compatibility for SharkMotion tools in all browsers.
 */
(function (global) {
  'use strict';

  var root = typeof window !== 'undefined' ? window : global;

  // 1. Extension version
  root.EXTENSION_VERSION = '0.1';

  // 2. ExtendScript runtime globals mock ($ and app)
  root.$ = root.$ || {
    os: 'Browser',
    evalFile: function (path) { return true; },
    global: root
  };

  root.app = root.app || {
    version: 'Web App',
    project: {
      file: { name: 'SharkMotion Project' },
      activeItem: null
    },
    preferences: {
      getPrefAsLong: function () { return 1; }
    },
    beginUndoGroup: function () {},
    endUndoGroup: function () {},
    executeCommand: function () {},
    findMenuCommandId: function () { return 0; }
  };

  root.Folder = root.Folder || function (path) {
    return {
      fullName: path || '/web_storage',
      exists: true,
      execute: function () { return true; },
      toString: function () { return path || '/web_storage'; }
    };
  };
  root.Folder.temp = {
    fullName: '/web_storage/temp',
    toString: function () { return '/web_storage/temp'; }
  };

  root.File = root.File || function (path) {
    return {
      fullName: path || '',
      open: function () { return true; },
      write: function () { return true; },
      close: function () { return true; },
      remove: function () { return true; }
    };
  };

  // 3. FileStore Web storage persistence mock
  root.FileStore = root.FileStore || (function () {
    var _cache = {};
    function getDB() {
      return (root.parent && root.parent.SharkDatabase) || root.SharkDatabase;
    }
    function load() {
      try {
        var db = getDB();
        var raw = db ? db.getSyncSettings() : (localStorage.getItem('sharktools_save') || localStorage.getItem('fishtools_save'));
        _cache = raw ? JSON.parse(raw) : {};
      } catch (e) {
        _cache = {};
      }
      if (!_cache || typeof _cache !== 'object') _cache = {};
      if (!_cache.config) {
        _cache.config = {
          version: '0.1',
          theme: 'dark',
          uiStyle: 'simple',
          animEnabled: true,
          snapScroll: false,
          tipsEnabled: false,
          lastTab: 'tools'
        };
      }
    }
    function save() {
      try {
        var jsonStr = JSON.stringify(_cache);
        var db = getDB();
        if (db) {
          db.saveSyncSettings(jsonStr);
        } else {
          localStorage.setItem('sharktools_save', jsonStr);
        }
      } catch (e) {}
    }
    load();
    return {
      init: function () { load(); },
      load: load,
      save: save,
      get: function (k) { return _cache[k]; },
      set: function (k, v) { _cache[k] = v; save(); },
      remove: function (k) { delete _cache[k]; save(); },
      getAll: function () { return JSON.parse(JSON.stringify(_cache)); },
      clear: function () { _cache = {}; save(); },
      replace: function (d) { _cache = d || {}; save(); },
      getDataDir: function () { return '/web_storage'; },
      isLocalStorage: function () { return true; }
    };
  })();

  // 4. Central SharkTools / FishTools Execution Bridge
  function dispatchTool(toolName, args) {
    args = args || [];
    var parent = root.parent || root;
    var exec = (parent && typeof parent.executeSharkTool === 'function')
      ? parent.executeSharkTool
      : ((parent && typeof parent.executeFishTool === 'function')
        ? parent.executeFishTool
        : (typeof root.executeSharkTool === 'function'
          ? root.executeSharkTool
          : (typeof root.executeFishTool === 'function' ? root.executeFishTool : null)));

    var res;
    if (typeof exec === 'function') {
      res = exec.apply(parent, [toolName].concat(args));
    }

    var bridge = (parent && parent.SharkToolsBridge) || parent.FishToolsBridge || root.SharkToolsBridge || root.FishToolsBridge;
    if (res === undefined && bridge && typeof bridge.executeTool === 'function') {
      res = bridge.executeTool.apply(bridge, [toolName].concat(args));
    }

    // Always also broadcast via postMessage to guarantee delivery if sandboxed
    try {
      if (root.parent && root.parent !== root) {
        root.parent.postMessage({
          type: 'sharktools-run-tool',
          tool: toolName,
          args: args
        }, '*');
      }
    } catch (e) {}

    return res !== undefined ? res : 'true';
  }

  var toolsBridge = {
    executeTool: function (toolName) {
      var args = Array.prototype.slice.call(arguments, 1);
      return dispatchTool(toolName, args);
    },
    setAnchorPoint: function (pos) { return dispatchTool('setAnchorPoint', [pos]); },
    CENTERINCOMP: function () { return dispatchTool('CENTERINCOMP'); },
    CUT_FRONT: function () { return dispatchTool('CUT_FRONT'); },
    CUT_MID: function () { return dispatchTool('CUT_MID'); },
    CUT_BACK: function () { return dispatchTool('CUT_BACK'); },
    ALIGN_LEFT: function () { return dispatchTool('ALIGN_LEFT'); },
    ALIGN_HCENTER: function () { return dispatchTool('ALIGN_HCENTER'); },
    ALIGN_RIGHT: function () { return dispatchTool('ALIGN_RIGHT'); },
    ALIGN_TOP: function () { return dispatchTool('ALIGN_TOP'); },
    ALIGN_VCENTER: function () { return dispatchTool('ALIGN_VCENTER'); },
    ALIGN_BOTTOM: function () { return dispatchTool('ALIGN_BOTTOM'); },
    PRECOMP: function () { return dispatchTool('PRECOMP'); },
    PRECOMP_AUTOCROP: function () { return dispatchTool('PRECOMP_AUTOCROP'); },
    PRECOMPOSE: function () { return dispatchTool('PRECOMPOSE'); },
    OVERLAP: function () { return dispatchTool('OVERLAP'); },
    PNG: function () { return dispatchTool('PNG'); },
    DUP: function (name) { return dispatchTool('DUP', [name]); },
    changeCompRatio: function (w, h) { return dispatchTool('changeCompRatio', [w, h]); },
    changeCompFPS: function (fps) { return dispatchTool('changeCompFPS', [fps]); }
  };

  root.SharkTools = toolsBridge;
  root.FishTools = toolsBridge;

  // 5. Adobe CEP Environment Mock (__adobe_cep__)
  root.__adobe_cep__ = root.__adobe_cep__ || {
    getHostEnvironment: function () {
      return JSON.stringify({
        appId: 'PHXS',
        appName: 'Web App',
        appVersion: '0.1',
        appLocale: 'en_US',
        appUILocale: 'en_US',
        isAppOnline: true,
        appSkinInfo: {
          baseFontFamily: 'Inter',
          baseFontSize: 12,
          appBarBackgroundColor: { color: { red: 5, green: 10, blue: 18 } },
          panelBackgroundColor: { color: { red: 5, green: 10, blue: 18 } }
        }
      });
    },
    getHostCapabilities: function () {
      return JSON.stringify({
        EXTENDED_PANEL_MENU: true
      });
    },
    evalScript: function (script, callback) {
      var res = 'true';
      try {
        if (typeof script !== 'string') script = String(script || '');

        if (script.indexOf('app.version') !== -1) {
          res = 'Web App';
        } else if (script.indexOf('$.os') !== -1) {
          res = 'Browser';
        } else if (script.indexOf('app.project.file') !== -1) {
          var pName = (root.parent && root.parent.currentProjectState && root.parent.currentProjectState.name) || 'SharkMotion Project';
          res = pName;
        } else if (script.indexOf('$.evalFile') !== -1) {
          res = 'true';
        } else if (script.indexOf('Pref_SCRIPTING_FILE_NETWORK_SECURITY') !== -1) {
          res = 'ok';
        } else {
          // Direct executeTool invocation pattern: FishTools.executeTool("...") or SharkTools.executeTool("...")
          var toolMatch = script.match(/(?:FishTools|SharkTools)\.executeTool\(\s*["']([^"']+)["'](?:\s*,\s*([^)]+))?\)/);
          if (toolMatch) {
            var toolName = toolMatch[1];
            var parsedArgs = [];
            if (toolMatch[2]) {
              try {
                parsedArgs = JSON.parse('[' + toolMatch[2] + ']');
              } catch (_) {
                parsedArgs = [toolMatch[2].replace(/^["']|["']$/g, '')];
              }
            }
            res = dispatchTool(toolName, parsedArgs);
          } else {
            try {
              res = new Function('window', 'with(window){ return ' + script + '; }')(root);
            } catch (_) {
              res = new Function('window', 'with(window){ ' + script + ' }')(root);
            }
          }
        }
      } catch (e) {
        console.warn('[CEP Polyfill] evalScript error:', e, script);
        res = JSON.stringify({ error: true, type: 'error', message: (e.message || String(e)).replace(/"/g, "'") });
      }

      if (typeof callback === 'function') {
        callback(typeof res === 'string' ? res : (res !== undefined ? JSON.stringify(res) : 'true'));
      }
    },
    invokeSync: function () {
      return JSON.stringify({ error: 0 });
    },
    getSystemPath: function () {
      return '/web_storage';
    },
    setPanelFlyoutMenu: function () {},
    openURLInDefaultBrowser: function (url) {
      window.open(url, '_blank');
    },
    addEventListener: function () {},
    removeEventListener: function () {},
    dispatchEvent: function () {},
    requestOpenExtension: function () {},
    closeExtension: function () {}
  };

  // 6. window.cep File System mock
  root.cep = root.cep || {
    fs: {
      readFile: function (path) {
        if (path && path.indexOf('manifest.xml') !== -1) {
          return { err: 0, data: '<ExtensionManifest ExtensionBundleVersion="0.1"></ExtensionManifest>' };
        }
        var db = (root.parent && root.parent.SharkDatabase) || root.SharkDatabase;
        var raw = db ? db.getSyncSettings() : (localStorage.getItem('sharktools_save') || localStorage.getItem('fishtools_save'));
        var dataObj = {};
        try { dataObj = raw ? JSON.parse(raw) : {}; } catch (e) {}
        if (!dataObj.config) {
          dataObj.config = {
            version: '0.1',
            theme: 'dark',
            uiStyle: 'simple',
            animEnabled: true,
            snapScroll: false,
            tipsEnabled: false,
            lastTab: 'tools'
          };
        }
        return { err: 0, data: JSON.stringify(dataObj) };
      },
      writeFile: function (path, data) {
        var db = (root.parent && root.parent.SharkDatabase) || root.SharkDatabase;
        if (db) {
          db.saveSyncSettings(data);
        } else {
          try {
            localStorage.setItem('sharktools_save', data);
          } catch (e) {}
        }
        return { err: 0 };
      },
      stat: function (path) {
        var isDir = !path || path.indexOf('.') === -1;
        return {
          err: 0,
          data: {
            isDirectory: function () { return isDir; },
            isFile: function () { return !isDir; }
          }
        };
      },
      makedir: function () { return { err: 0 }; },
      deleteFile: function () { return { err: 0 }; }
    }
  };

  root.SystemPath = root.SystemPath || {
    EXTENSION: 'EXT',
    USER_DATA: 'USER_DATA',
    HOST_APPLICATION: 'HOST'
  };

  // Mock disabled/optional modules
  root.TipsModule = root.TipsModule || function () {
    return {
      init: function () {},
      showRandomTip: function () {},
      destroy: function () {}
    };
  };

  root.UpdateModule = root.UpdateModule || {
    init: function () {},
    checkUpdate: function () {}
  };

})(typeof window !== 'undefined' ? window : this);
